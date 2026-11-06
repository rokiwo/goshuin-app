// Gemini API 連携サービス（ブラウザから直接 Google Generative Language API を呼び出し、サーバーレスで動作）
// デフォルトモデルとして「gemini-3.8-flash」を標準搭載し、Google検索グラウンディング＆過去御朱印写真の自動読み取りにも対応

const STORAGE_KEY_API = 'goshuin_gemini_api_key';
const STORAGE_KEY_MODEL = 'goshuin_gemini_model';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

// 公式モデル一覧に完全対応
export const AVAILABLE_GEMINI_MODELS = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash（デフォルト・推奨）',
    description: '最新の主力Flashモデル。Web検索による実在御朱印調査・写真解読・ルート作成に最適'
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    description: 'バランスの取れた高速マルチモーダルFlashモデル'
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite（超低コスト・軽量）',
    description: '軽量・高速レスポンスでコストを最小限に抑えられるLiteモデル'
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash-Lite',
    description: 'テキスト解説やルート作成を軽快にこなす軽量モデル'
  }
];

/**
 * 現在設定されているGemini APIキーを取得
 */
export function getGeminiApiKey() {
  const saved = localStorage.getItem(STORAGE_KEY_API);
  if (saved && saved.trim()) return saved.trim();
  if (import.meta.env.VITE_GEMINI_API_KEY) {
    return String(import.meta.env.VITE_GEMINI_API_KEY).trim();
  }
  return '';
}

/**
 * Gemini APIキーを端末に保存
 */
export function setGeminiApiKey(key) {
  if (!key) {
    localStorage.removeItem(STORAGE_KEY_API);
  } else {
    localStorage.setItem(STORAGE_KEY_API, key.trim());
  }
}

/**
 * 現在選択されているGeminiモデル名を取得（初期値: gemini-3.8-flash）
 */
export function getGeminiModel() {
  const saved = localStorage.getItem(STORAGE_KEY_MODEL);
  return saved && saved.trim() ? saved.trim() : DEFAULT_GEMINI_MODEL;
}

/**
 * 使用するGeminiモデル名を端末に保存
 */
export function setGeminiModel(modelId) {
  localStorage.setItem(STORAGE_KEY_MODEL, modelId.trim() || DEFAULT_GEMINI_MODEL);
}

/**
 * 指定されたモデルIDでGoogle Generative Language APIへリクエストを送る内部関数
 */
async function requestGeminiEndpoint(modelId, parts, generationConfig, apiKey, tools = null) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts
      }
    ],
    generationConfig
  };

  if (tools) {
    payload.tools = tools;
  }

  return await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

/**
 * Gemini API 共通呼び出し関数（JSON構造化出力＆Google検索グラウンディング＆フォールバック対応）
 */
async function callGeminiApi({
  parts,
  responseSchema = null,
  temperature = 0.35,
  useGoogleSearch = false
}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('API_KEY_MISSING');
  }

  const primaryModel = getGeminiModel();
  const generationConfig = {
    temperature
  };

  if (responseSchema && !useGoogleSearch) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = responseSchema;
  }

  const candidateModels = [
    primaryModel,
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash'
  ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

  let response = null;
  let lastErrorText = '';
  let lastStatus = 0;

  const tools = useGoogleSearch ? [{ google_search: {} }] : null;

  for (const modelId of candidateModels) {
    response = await requestGeminiEndpoint(modelId, parts, generationConfig, apiKey, tools);
    if (response.ok) {
      break;
    }
    if (useGoogleSearch && response.status === 400) {
      response = await requestGeminiEndpoint(modelId, parts, generationConfig, apiKey, null);
      if (response.ok) break;
    }

    lastStatus = response.status;
    try {
      const errJson = await response.json();
      lastErrorText = errJson?.error?.message || response.statusText;
    } catch {
      lastErrorText = response.statusText;
    }
    if (response.status !== 404) {
      break;
    }
  }

  if (!response || !response.ok) {
    throw new Error(`Gemini APIエラー (${lastStatus}): ${lastErrorText}`);
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text || '').join('\n') || '';
  if (!text) {
    throw new Error('AIからの応答テキストが空でした。');
  }

  const groundingChunks = candidate?.groundingMetadata?.groundingChunks || [];
  const webSources = groundingChunks
    .map((c) => c.web)
    .filter((w) => w && w.uri)
    .map((w) => ({
      title: w.title || '参照Webサイト',
      uri: w.uri
    }));

  if (responseSchema && !useGoogleSearch) {
    return JSON.parse(text);
  }

  if (useGoogleSearch) {
    return { text, webSources };
  }

  return text;
}

/**
 * 機能1: 寺社のAI深掘り解説＋Web上の実在御朱印レポート（ホトカミ・Omairi・SNS・公式情報）を検索・生成
 */
export async function generateSpotAiGuide(spot) {
  const prompt = `
あなたは日本の神社仏閣と御朱印文化に精通した専門リサーチャーです。
以下の寺社について、Web（神社庁・公式サイト・ホトカミ・Omairi・Instagram等の投稿傾向）で知られている実際の授与御朱印情報と由緒をJSON形式で作成してください。

【対象寺社】
- 名称: ${spot.name}
- 種別: ${spot.type === 'shrine' ? '神社' : '寺院'}
- 宗派・系統: ${spot.denomination || '不明'}
- 所在地: ${spot.address || '日本'}
- 緯度経度: ${spot.lat}, ${spot.lng}

【重要】
- realGoshuinList には、この寺社で実際に授与されている（またはSNS・御朱印サイトで報告されている）具体的な御朱印の種類（例：通常御朱印、季節の切り絵御朱印、月替わり御朱印、札所御朱印など）と、デザインの特徴（どんな印やイラスト・文字が入っているか）、初穂料目安、授与形態（直書き／書き置き等）を2〜3件挙げてください。
- もし無人社等で御朱印の有無が不確定な場合は、本務社（兼務社）で授与されるケースや確認方法を明記してください。
`;

  const schema = {
    type: 'OBJECT',
    properties: {
      deityOrBuddha: {
        type: 'STRING',
        description: '主祭神または御本尊の名前と分かりやすい説明'
      },
      blessings: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        description: '代表的なご利益（3〜4個、例：縁結び、厄除け、海上安全など）'
      },
      historyAndHighlights: {
        type: 'STRING',
        description: '由緒・歴史的背景・境内の見どころ（150〜250文字程度）'
      },
      goshuinAdvice: {
        type: 'STRING',
        description: '社務所・寺務所の受付時間目安や拝受する際のアドバイス（100〜160文字程度）'
      },
      recommendedCalligraphy: {
        type: 'STRING',
        description: 'この寺社の御朱印に実際に書かれる代表的な揮毫（墨書）文字'
      },
      realGoshuinList: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: {
              type: 'STRING',
              description: '御朱印の名称（例：通常御朱印「生田神社」、季節限定切り絵御朱印など）'
            },
            visualDetail: {
              type: 'STRING',
              description: 'インスタやWebで投稿されている実物の見た目・朱印のモチーフ・紙の特徴'
            },
            feeAndStyle: {
              type: 'STRING',
              description: '初穂料・納経料の目安と授与スタイル（直書き・書き置きなど）'
            }
          },
          required: ['name', 'visualDetail', 'feeAndStyle']
        }
      }
    },
    required: [
      'deityOrBuddha',
      'blessings',
      'historyAndHighlights',
      'goshuinAdvice',
      'recommendedCalligraphy',
      'realGoshuinList'
    ]
  };

  const structuredGuide = await callGeminiApi({
    parts: [{ text: prompt }],
    responseSchema: schema,
    temperature: 0.3
  });

  try {
    const searchPrompt = `「${spot.name}」（${spot.address}）で実際に授与されている御朱印の種類、最新の限定御朱印、初穂料、受付時間についてWeb上の情報を簡潔にまとめてください。`;
    const grounded = await callGeminiApi({
      parts: [{ text: searchPrompt }],
      useGoogleSearch: true,
      temperature: 0.2
    });
    structuredGuide.webSearchSummary = grounded.text;
    structuredGuide.webSources = grounded.webSources || [];
  } catch {
    structuredGuide.webSources = [];
  }

  return structuredGuide;
}

/**
 * 機能2: 撮影した御朱印写真（Base64）をGemini Visionでマルチモーダル解析し、
 * 墨書（達筆な文字）の解読・朱印の意味・ご利益を鑑定する
 */
export async function analyzeGoshuinPhotoWithAi(spot, photoDataUrl) {
  const matches = photoDataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!matches) {
    throw new Error('画像データの形式が不正です。');
  }
  const mimeType = matches[1];
  const base64Data = matches[2];

  const prompt = `
あなたは書道・古文書・神社仏閣の御朱印鑑定の専門家です。
添付された御朱印の写真（参拝先候補: ${spot.name}）を注意深く観察し、以下の項目をJSONで解読・解説してください。

1. calligraphyReading: 中央や左右に墨で書かれている主な文字（墨書・揮毫）の解読（奉拝・寺社名・御本尊名・日付など）
2. sealReading: 押されている赤い朱印やスタンプ・梵字・モチーフの特徴と読み取れる文字
3. meaningAndBlessing: 書かれている言葉や御本尊の意味・ご利益の分かりやすい解説
4. artisticImpression: 筆致（力強い、流麗、繊細など）や全体のデザインの魅力についての感想コメント
5. summaryForMemo: 御朱印帳のひとことメモにそのまま使える60文字以内の要約
`;

  const schema = {
    type: 'OBJECT',
    properties: {
      calligraphyReading: {
        type: 'STRING',
        description: '墨書（黒い文字）で書かれている内容の解読結果'
      },
      sealReading: {
        type: 'STRING',
        description: '朱印（赤い印章・スタンプ・モチーフ）の読み取り結果'
      },
      meaningAndBlessing: {
        type: 'STRING',
        description: '揮毫された言葉や御神徳・御本尊の意味とご利益の解説'
      },
      artisticImpression: {
        type: 'STRING',
        description: '書風や印の配置など芸術的な魅力のコメント'
      },
      summaryForMemo: {
        type: 'STRING',
        description: '参拝メモ用の60文字以内の要約文'
      }
    },
    required: [
      'calligraphyReading',
      'sealReading',
      'meaningAndBlessing',
      'artisticImpression',
      'summaryForMemo'
    ]
  };

  return await callGeminiApi({
    parts: [
      { text: prompt },
      {
        inlineData: {
          mimeType,
          data: base64Data
        }
      }
    ],
    responseSchema: schema,
    temperature: 0.25
  });
}

/**
 * 機能3: 過去にいただいた御朱印の写真から「寺社名・参拝日・場所（都道府県市区町村）・種別（神社/寺院）・メモ」をAIで自動読み取りする関数
 */
export async function extractPastGoshuinFromPhoto(photoDataUrl) {
  const matches = photoDataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!matches) {
    throw new Error('画像データの形式が不正です。');
  }
  const mimeType = matches[1];
  const base64Data = matches[2];

  const prompt = `
あなたは日本の御朱印の鑑定・読み取りの専門家です。
添付された御朱印の写真から、以下の情報を読み取ってJSONで返してください。

- spotName: 神社または寺院の名前（朱印や墨書から特定できる正式名称。不明な場合は書かれている主要な文字）
- spotType: 神社なら "shrine"、寺院なら "temple"
- visitedDateISO: 写真内に書かれている参拝日付を西暦の "YYYY-MM-DD" 形式に変換したもの（例：令和六年五月三日 → "2024-05-03"、平成三十年十月一日 → "2018-10-01"）。年や日が読み取れない場合は空文字 ""
- visitedDateText: 写真に書かれている日付の和暦または日本語表記（例：「2024年5月3日（令和6年5月3日）」）
- estimatedAddress: その寺社がある都道府県・市区町村（分かる範囲で、例：「京都府京都市伏見区」）
- memoSummary: 墨書されている文字とご利益の簡潔な説明（50文字程度）
`;

  const schema = {
    type: 'OBJECT',
    properties: {
      spotName: { type: 'STRING' },
      spotType: { type: 'STRING', enum: ['shrine', 'temple'] },
      visitedDateISO: { type: 'STRING' },
      visitedDateText: { type: 'STRING' },
      estimatedAddress: { type: 'STRING' },
      memoSummary: { type: 'STRING' }
    },
    required: [
      'spotName',
      'spotType',
      'visitedDateISO',
      'visitedDateText',
      'estimatedAddress',
      'memoSummary'
    ]
  };

  return await callGeminiApi({
    parts: [
      { text: prompt },
      {
        inlineData: {
          mimeType,
          data: base64Data
        }
      }
    ],
    responseSchema: schema,
    temperature: 0.2
  });
}

/**
 * 機能4: 現在地周辺の寺社リストから「AI御朱印めぐりモデルコース」を自動作成する
 */
export async function generateAiPilgrimageRoute({
  userLocation,
  spots,
  visitMap,
  transportMode = 'walk_train',
  durationHours = 3
}) {
  const candidateSpots = spots.slice(0, 18).map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type === 'shrine' ? '神社' : '寺院',
    denomination: s.denomination,
    distanceKm: s.distanceKm,
    visited: Boolean(visitMap[s.id]?.visited)
  }));

  const modeLabel =
    transportMode === 'walk'
      ? '徒歩メインでお散歩'
      : transportMode === 'car'
      ? '車・ドライブで広域巡拝'
      : '電車・バス＋徒歩で快適巡拝';

  const prompt = `
あなたは御朱印めぐりの旅プランナーです。
現在地（緯度:${userLocation.lat}, 経度:${userLocation.lng}）の周辺にある以下の神社仏閣リストから、
「${modeLabel}」「所要時間：約${durationHours}時間」で楽しく回れる最適な御朱印めぐりコース（3〜5箇所）を提案してください。
未参拝のスポットを優先しつつ、地理的に無理のない順番で組んでください。

【候補スポット一覧】
${JSON.stringify(candidateSpots, null, 2)}
`;

  const schema = {
    type: 'OBJECT',
    properties: {
      courseTitle: {
        type: 'STRING',
        description: 'ワクワクするような御朱印めぐりコースのタイトル'
      },
      concept: {
        type: 'STRING',
        description: 'このコースの魅力・テーマ（100文字程度）'
      },
      totalEstimatedTime: {
        type: 'STRING',
        description: '全体の所要時間目安（例：約2時間45分）'
      },
      steps: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            order: { type: 'INTEGER' },
            spotId: {
              type: 'STRING',
              description: '候補スポット一覧の id と完全一致する文字列'
            },
            spotName: { type: 'STRING' },
            stayMinutes: { type: 'INTEGER', description: '滞在目安分数' },
            travelNote: {
              type: 'STRING',
              description: '前の地点からの移動手段・所要時間の目安'
            },
            highlightTip: {
              type: 'STRING',
              description: 'この寺社での参拝ポイントや御朱印の楽しみ方'
            }
          },
          required: ['order', 'spotId', 'spotName', 'stayMinutes', 'travelNote', 'highlightTip']
        }
      },
      closingAdvice: {
        type: 'STRING',
        description: '社務所の受付時間（通常9:00〜16:30頃）や小銭の準備など参拝のワンポイントアドバイス'
      }
    },
    required: ['courseTitle', 'concept', 'totalEstimatedTime', 'steps', 'closingAdvice']
  };

  return await callGeminiApi({
    parts: [{ text: prompt }],
    responseSchema: schema,
    temperature: 0.45
  });
}
