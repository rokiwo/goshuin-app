import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  X,
  Camera,
  Calendar,
  MapPin,
  Sparkles,
  Wand2,
  Loader2,
  Check,
  Search,
  RotateCw,
  BookOpen,
  Layers,
  ChevronLeft
} from 'lucide-react';
import {
  db,
  saveVisitRecord,
  compressImageToBase64,
  rotateBase64Image90,
  createAdditionalEntryId,
  suggestGroupNameForSpot,
  getAllCustomGroupNames
} from '../db/database.js';
import {
  extractPastGoshuinFromPhoto,
  getGeminiApiKey
} from '../services/geminiService.js';
import {
  searchShrineCandidatesByName,
  inferSpotTypeFromName
} from '../services/shrineSearchService.js';

/**
 * すでに持っている過去の御朱印を「写真・日付・場所（寺社名・所在地）」で
 * 自由にデジタル御朱印帳＆マップへ追加登録できるモーダルコンポーネント
 * ★神社・お寺の名前を入力すると全国の同名社寺を含めた「住所候補リスト」を自動表示します
 * ★実物の御朱印帳への振り分けや巡拝グループ設定にも対応
 */
export default function PastGoshuinModal({
  isOpen,
  onClose,
  allSpots,
  books = [],
  userLocation,
  onRegistered,
  onOpenAiSettings
}) {
  const todayIso = new Date().toISOString().slice(0, 10);

  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [spotName, setSpotName] = useState('');
  const [spotType, setSpotType] = useState('shrine'); // 'shrine' | 'temple'
  const [visitedDateIso, setVisitedDateIso] = useState(todayIso);
  const [addressText, setAddressText] = useState('');
  const [memoText, setMemoText] = useState('');
  const [selectedBookId, setSelectedBookId] = useState(books[0]?.id || '');
  const [groupNameText, setGroupNameText] = useState('');
  const [existingGroupNames, setExistingGroupNames] = useState([]);

  // 全国社寺・同名神社の住所候補ステート
  const [areaFilter, setAreaFilter] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [isSearchingCandidates, setIsSearchingCandidates] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  const [isCompressing, setIsCompressing] = useState(false);
  const [isAiReading, setIsAiReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const fileInputRef = useRef(null);

  // モーダルオープン時に既存のグループ名一覧をDBから収集
  useEffect(() => {
    if (isOpen) {
      db.visits.toArray().then((recs) => {
        setExistingGroupNames(getAllCustomGroupNames(recs));
      }).catch(() => {});
    }
  }, [isOpen]);

  // booksが渡された際の初期選択追従
  useEffect(() => {
    if (!selectedBookId && books.length > 0) {
      setSelectedBookId(books[0].id);
    }
  }, [books, selectedBookId]);

  // 社寺名から巡拝グループ候補を算出
  const suggestedGroup = suggestGroupNameForSpot(spotName);

  // 神社・お寺の名前（または地域絞り込み）が入力されたら全国の同名社寺＆住所候補を「現在地から近い順」に自動検索
  useEffect(() => {
    if (!isOpen) return;
    const cleanName = spotName.trim();
    if (cleanName.length < 2) {
      setCandidates([]);
      setIsSearchingCandidates(false);
      return;
    }

    let cancelled = false;
    setIsSearchingCandidates(true);

    const timer = setTimeout(async () => {
      try {
        const list = await searchShrineCandidatesByName(
          cleanName,
          areaFilter.trim(),
          allSpots,
          userLocation
        );
        if (!cancelled) {
          setCandidates(list);
        }
      } catch {
        if (!cancelled) {
          setCandidates([]);
        }
      } finally {
        if (!cancelled) {
          setIsSearchingCandidates(false);
        }
      }
    }, 320);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [spotName, areaFilter, isOpen, allSpots, userLocation]);

  if (!isOpen) return null;

  // YYYY-MM-DD を「2026年10月18日」形式に整形
  const formatJapaneseDate = (isoStr) => {
    if (!isoStr) return '記録済';
    const parts = isoStr.split('-');
    if (parts.length !== 3) return isoStr;
    return `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`;
  };

  // 写真選択時の処理
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');
    try {
      setIsCompressing(true);
      const base64 = await compressImageToBase64(file);
      setPhotoDataUrl(base64);
    } catch {
      setErrorMsg('画像の読み込みに失敗しました。');
    } finally {
      setIsCompressing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 見開き御朱印などで写真が縦向きになっている場合に90°回転する処理
  const handleRotatePhoto = async () => {
    if (!photoDataUrl || isCompressing) return;
    try {
      setIsCompressing(true);
      const rotated = await rotateBase64Image90(photoDataUrl, true);
      setPhotoDataUrl(rotated);
    } catch {
      setErrorMsg('写真の回転に失敗しました。');
    } finally {
      setIsCompressing(false);
    }
  };

  // AIで御朱印写真から「神社・お寺の名前」「日付」「場所」「メモ」を自動入力
  const handleAiAutoFill = async () => {
    if (!photoDataUrl) return;
    if (!getGeminiApiKey()) {
      onOpenAiSettings();
      return;
    }
    setErrorMsg('');
    try {
      setIsAiReading(true);
      const result = await extractPastGoshuinFromPhoto(photoDataUrl);
      if (result.spotName) {
        setSpotName(result.spotName);
        setSelectedCandidate(null);
      }
      if (result.spotType === 'shrine' || result.spotType === 'temple') {
        setSpotType(result.spotType);
      }
      if (result.visitedDateISO && /^\d{4}-\d{2}-\d{2}$/.test(result.visitedDateISO)) {
        setVisitedDateIso(result.visitedDateISO);
      }
      if (result.estimatedAddress) setAddressText(result.estimatedAddress);
      if (result.memoSummary && !memoText) setMemoText(result.memoSummary);
    } catch (err) {
      if (err.message === 'API_KEY_MISSING') {
        onOpenAiSettings();
      } else {
        setErrorMsg(err.message || 'AI自動読み取りに失敗しました。手入力でも登録できます。');
      }
    } finally {
      setIsAiReading(false);
    }
  };

  // 住所候補をタップしたときの反映処理
  const handleSelectCandidate = (cand) => {
    setSelectedCandidate(cand);
    setSpotName(cand.name);
    setSpotType(cand.type || inferSpotTypeFromName(cand.name, spotType));
    setAddressText(cand.address || '');
  };

  // 手動で今すぐ候補を再検索するボタン用
  const handleManualSearchCandidates = async () => {
    const cleanName = spotName.trim();
    if (!cleanName) return;
    setIsSearchingCandidates(true);
    try {
      const list = await searchShrineCandidatesByName(
        cleanName,
        areaFilter.trim(),
        allSpots,
        userLocation
      );
      setCandidates(list);
    } finally {
      setIsSearchingCandidates(false);
    }
  };

  // 入力された寺社・選択された住所候補をもとに保存
  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanName = spotName.trim();
    if (!cleanName) {
      setErrorMsg('神社・お寺の名前を入力してください。');
      return;
    }

    setIsSaving(true);
    setErrorMsg('');

    try {
      let targetSpot = null;

      // 1. ユーザーが住所候補リストから選択している場合はその座標・住所を優先使用
      if (
        selectedCandidate &&
        selectedCandidate.name === cleanName &&
        typeof selectedCandidate.lat === 'number' &&
        typeof selectedCandidate.lng === 'number'
      ) {
        // 既存スポットに同一IDまたは同座標のものがあればそれを利用
        const matchedExisting = allSpots.find(
          (s) =>
            s.id === selectedCandidate.id ||
            (Math.abs(s.lat - selectedCandidate.lat) < 0.002 &&
              Math.abs(s.lng - selectedCandidate.lng) < 0.002 &&
              s.name === cleanName)
        );

        if (matchedExisting) {
          targetSpot = {
            ...matchedExisting,
            address: addressText.trim() || matchedExisting.address
          };
        } else {
          targetSpot = {
            id: selectedCandidate.id.startsWith('local-')
              ? `custom-${Date.now()}`
              : selectedCandidate.id,
            name: cleanName,
            type: spotType,
            denomination:
              selectedCandidate.denomination ||
              (spotType === 'shrine' ? '神道（神社）' : '仏教（寺院）'),
            address: addressText.trim() || selectedCandidate.address || '日本',
            lat: selectedCandidate.lat,
            lng: selectedCandidate.lng,
            description: 'マイ御朱印帳に追加登録された参拝スポットです。',
            sampleGoshuin: selectedCandidate.sampleGoshuin || [
              {
                id: `custom-sample-${Date.now()}`,
                title: `御朱印「${cleanName}」`,
                badge: 'マイ御朱印帳登録',
                fee: '拝受済',
                calligraphy: cleanName.slice(0, 4),
                subText: formatJapaneseDate(visitedDateIso),
                stampText: `${cleanName.slice(0, 3)}印`,
                motif: spotType === 'shrine' ? 'torii' : 'lotus',
                description: `${cleanName}にて拝受した御朱印の記録です。`
              }
            ]
          };
        }
      }

      // 2. 候補未選択の場合は、既存スポット一覧で名前＆住所が一致するものを探す
      if (!targetSpot) {
        const cleanAddr = addressText.trim();
        const existingSpot = allSpots.find((s) => {
          const sameName =
            s.name === cleanName ||
            s.name.replace(/（.*?）|\(.*?\)/g, '') === cleanName;
          if (!sameName) return false;
          if (!cleanAddr) return true;
          return (
            (s.address || '').includes(cleanAddr) ||
            cleanAddr.includes(s.address || '')
          );
        });
        if (existingSpot) {
          targetSpot = existingSpot;
        }
      }

      // 3. まだtargetSpotが決まっていない場合は、無料ジオコーディング（Nominatim）で座標と住所を取得
      if (!targetSpot) {
        let lat = 34.6494;
        let lng = 134.9961;
        let resolvedAddr = addressText.trim() || '日本';

        try {
          const queryStr = `${cleanName} ${addressText.trim()}`.trim();
          const nomUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=jp&q=${encodeURIComponent(
            queryStr
          )}&limit=1&accept-language=ja`;
          const nomRes = await fetch(nomUrl);
          if (nomRes.ok) {
            const nomData = await nomRes.json();
            if (Array.isArray(nomData) && nomData.length > 0) {
              lat = parseFloat(nomData[0].lat);
              lng = parseFloat(nomData[0].lon);
              if (!addressText.trim() && nomData[0].display_name) {
                resolvedAddr = nomData[0].display_name
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => s && s !== '日本' && !/^\d{3}-?\d{4}$/.test(s) && s !== cleanName)
                  .reverse()
                  .join('');
              }
            }
          }
        } catch {
          // 座標取得失敗時はデフォルト座標を設定
        }

        targetSpot = {
          id: `custom-${Date.now()}`,
          name: cleanName,
          type: spotType,
          denomination: spotType === 'shrine' ? '神道（神社）' : '仏教（寺院）',
          address: resolvedAddr,
          lat,
          lng,
          description: 'マイ御朱印帳に追加登録された参拝スポットです。',
          sampleGoshuin: [
            {
              id: `custom-sample-${Date.now()}`,
              title: `御朱印「${cleanName}」`,
              badge: 'マイ御朱印帳登録',
              fee: '拝受済',
              calligraphy: cleanName.slice(0, 4),
              subText: formatJapaneseDate(visitedDateIso),
              stampText: `${cleanName.slice(0, 3)}印`,
              motif: spotType === 'shrine' ? 'torii' : 'lotus',
              description: `${cleanName}にて拝受した御朱印の記録です。`
            }
          ]
        };
      }

      // 同一社寺で既に登録があるかどうかをチェックし、複数登録の場合は新IDを発行
      const existingRecord = await db.visits.get(targetSpot.id);
      let actualSpotToSave = targetSpot;
      if (existingRecord && existingRecord.visited) {
        actualSpotToSave = {
          ...targetSpot,
          id: createAdditionalEntryId(targetSpot.id),
          placeId: targetSpot.id
        };
      }

      // IndexedDB（Dexie.js）に永続保存
      const savedRecord = await saveVisitRecord(actualSpotToSave, {
        visited: true,
        visitedDate: formatJapaneseDate(visitedDateIso),
        photoDataUrl: photoDataUrl || undefined,
        memo: memoText.trim(),
        bookId: selectedBookId || '',
        groupName: groupNameText.trim(),
        placeId: targetSpot.id
      });

      confetti({
        particleCount: 70,
        spread: 75,
        origin: { y: 0.65 },
        colors: ['#c93a40', '#c5a059', '#fcfaf2']
      });

      // フォームをリセットして閉じる
      setPhotoDataUrl(null);
      setSpotName('');
      setAddressText('');
      setAreaFilter('');
      setMemoText('');
      setGroupNameText('');
      setCandidates([]);
      setSelectedCandidate(null);
      if (onRegistered) onRegistered(targetSpot, savedRecord);
      onClose();
    } catch (err) {
      setErrorMsg('保存中にエラーが発生しました: ' + (err.message || ''));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-sumi/75 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 w-full max-w-[430px] max-h-[92vh] washi-pattern rounded-t-3xl sm:rounded-3xl border-t-2 sm:border-2 border-kin shadow-2xl flex flex-col animate-slide-up overflow-hidden">
        {/* スマホ用シートグラブハンドル */}
        <div className="w-full flex justify-center pt-2 pb-1 bg-sumi sm:hidden">
          <div className="w-12 h-1 rounded-full bg-washi/30" />
        </div>

        {/* ヘッダー: 左に戻るボタン、右に閉じるボタン */}
        <div className="bg-sumi text-washi px-3 sm:px-5 py-3 border-b border-kin/40 flex items-center justify-between shrink-0 gap-2">
          {/* 左: 戻るボタン */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-washi/10 hover:bg-washi/20 text-washi text-xs font-serif font-bold active:scale-95 transition border border-washi/20"
            title="前の画面に戻る"
          >
            <ChevronLeft className="w-4 h-4 text-kin" />
            <span>戻る</span>
          </button>

          {/* 中央: タイトル */}
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-shuiro border border-kin flex items-center justify-center font-serif font-black text-xs text-washi shrink-0">
              追
            </div>
            <h2 className="font-serif font-bold text-xs sm:text-sm tracking-wide text-washi truncate">
              御朱印の登録
            </h2>
          </div>

          {/* 右: 閉じるボタン */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-shuiro/30 hover:bg-shuiro/50 text-washi text-xs font-serif font-bold active:scale-95 transition border border-shuiro/50"
            title="閉じる"
          >
            <span>閉じる</span>
            <X className="w-4 h-4 text-washi" />
          </button>
        </div>

        {/* フォーム本体 */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-sumi">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-shuiro-light border border-shuiro text-shuiro font-medium">
              {errorMsg}
            </div>
          )}

          {/* 1. 御朱印の写真登録＆AI自動読み取り */}
          <div className="space-y-2">
            <label className="font-serif font-bold text-sm flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-shuiro" />
              1. 御朱印の写真を選択
            </label>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            {photoDataUrl ? (
              <div className="jabara-card p-3 rounded-2xl space-y-2.5">
                <div className="w-full max-h-48 rounded-xl overflow-hidden bg-washi-dark border border-kin/50 flex items-center justify-center p-1 shadow-inner">
                  <img
                    src={photoDataUrl}
                    alt="登録する御朱印"
                    className="w-full max-h-44 object-contain rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isCompressing}
                      onClick={handleRotatePhoto}
                      className="py-2 px-2.5 rounded-xl bg-washi border border-kin text-sumi font-serif font-bold text-[11px] flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition"
                    >
                      <RotateCw className="w-3.5 h-3.5 text-shuiro" />
                      90°回転（見開き横向き）
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="py-2 px-2.5 rounded-xl bg-sumi text-washi text-[11px] font-bold flex items-center justify-center gap-1 active:scale-95 transition"
                    >
                      <Camera className="w-3.5 h-3.5 text-kin" />
                      写真を変更する
                    </button>
                  </div>

                  {/* AIで写真から名前・日付を自動入力する便利ボタン */}
                  <button
                    type="button"
                    disabled={isAiReading}
                    onClick={handleAiAutoFill}
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-shuiro to-shuiro-dark text-washi font-serif font-bold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition disabled:opacity-60"
                  >
                    {isAiReading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-kin" />
                        AIが写真から寺社名・日付を読取中...
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5 text-kin" />
                        AIで写真から寺社名・日付を自動入力
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={isCompressing}
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-4 px-4 rounded-2xl border-2 border-dashed border-kin bg-washi hover:bg-washi-dark/60 transition flex flex-col items-center justify-center gap-1 shadow-sm"
              >
                <div className="w-10 h-10 rounded-full bg-shuiro/10 text-shuiro flex items-center justify-center">
                  <Camera className="w-5 h-5" />
                </div>
                <span className="font-serif font-bold text-sm text-sumi">
                  {isCompressing ? '写真を読み込み中...' : 'スマホから御朱印の写真を選ぶ・撮影する'}
                </span>
                <span className="text-[10px] text-sumi-muted">
                  ※写真を選ぶと、AIで書かれている寺社名や日付の自動読み取りもできます
                </span>
              </button>
            )}
          </div>

          {/* 2. 神社・お寺の名前と全国の同名社寺・住所候補検索 */}
          <div className="space-y-2">
            <label className="font-serif font-bold text-sm flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-kin-dark" />
              2. 神社・お寺の名前（入力すると住所候補が出ます）
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSpotType('shrine')}
                className={`py-2 rounded-xl font-serif font-bold text-xs border transition ${
                  spotType === 'shrine'
                    ? 'bg-shuiro text-washi border-shuiro shadow-sm'
                    : 'bg-washi text-sumi-muted border-washi-border'
                }`}
              >
                ⛩️ 神社
              </button>
              <button
                type="button"
                onClick={() => setSpotType('temple')}
                className={`py-2 rounded-xl font-serif font-bold text-xs border transition ${
                  spotType === 'temple'
                    ? 'bg-tera text-washi border-tera shadow-sm'
                    : 'bg-washi text-sumi-muted border-washi-border'
                }`}
              >
                ☸️ 寺院（お寺）
              </button>
            </div>

            <div className="flex gap-1.5">
              <input
                type="text"
                value={spotName}
                onChange={(e) => {
                  const val = e.target.value;
                  setSpotName(val);
                  setSelectedCandidate(null);
                  if (val.trim()) {
                    setSpotType(inferSpotTypeFromName(val, spotType));
                  }
                }}
                placeholder="例：住吉神社、氷川神社、生田神社、清水寺 など"
                required
                className="flex-1 rounded-xl border border-washi-border bg-washi px-3.5 py-2.5 text-sm font-serif font-bold text-sumi focus:outline-none focus:border-shuiro"
              />
              <button
                type="button"
                onClick={handleManualSearchCandidates}
                disabled={isSearchingCandidates || !spotName.trim()}
                className="px-3 py-2 rounded-xl bg-sumi text-kin font-serif font-bold text-xs flex items-center gap-1 shrink-0 disabled:opacity-40 active:scale-95 transition"
                title="全国の神社・お寺から住所候補を検索"
              >
                {isSearchingCandidates ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>候補検索</span>
              </button>
            </div>

            {/* ★複数候補（同名神社・お寺の全国住所リスト・現在地から近い順）表示ボックス */}
            {spotName.trim().length >= 2 && (
              <div className="rounded-2xl border-2 border-kin/50 bg-washi-dark/90 p-3 space-y-2 shadow-inner">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-serif font-bold text-[11px] text-sumi flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-shuiro shrink-0" />
                    <span>
                      住所候補（現在地から近い順
                      {candidates.length > 0 ? `・${candidates.length}件` : ''}）
                    </span>
                  </span>

                  {/* 同名神社が全国にたくさんある場合の都道府県・市区町村絞り込みミニ入力 */}
                  <input
                    type="text"
                    value={areaFilter}
                    onChange={(e) => setAreaFilter(e.target.value)}
                    placeholder="地域で絞込 (例: 兵庫、京都)"
                    className="w-40 rounded-lg border border-kin/40 bg-washi px-2 py-1 text-[11px] text-sumi focus:outline-none focus:border-shuiro"
                  />
                </div>

                {isSearchingCandidates ? (
                  <div className="py-3 text-center text-[11px] text-sumi-muted flex items-center justify-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-shuiro" />
                    <span>現在地周辺および全国の「{spotName.trim()}」を検索中...</span>
                  </div>
                ) : candidates.length === 0 ? (
                  <p className="text-[11px] text-sumi-muted py-1.5">
                    一致する候補が見つかりませんでした。下の「4. 場所・住所」に直接入力して登録できます。
                  </p>
                ) : (
                  <>
                    <p className="text-[10px] text-sumi-muted">
                      ※現在地から近い順に表示しています。該当する場所をタップすると住所が自動入力されます：
                    </p>
                    <div className="max-h-44 overflow-y-auto space-y-1.5 pr-0.5">
                      {candidates.map((cand) => {
                        const isSelected = selectedCandidate?.id === cand.id;
                        return (
                          <button
                            key={cand.id}
                            type="button"
                            onClick={() => handleSelectCandidate(cand)}
                            className={`w-full text-left p-2.5 rounded-xl border transition flex items-start justify-between gap-2 ${
                              isSelected
                                ? 'bg-shuiro/10 border-shuiro ring-1 ring-shuiro shadow-sm'
                                : 'bg-washi border-kin/30 hover:border-shuiro/60'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-washi ${
                                    cand.type === 'shrine' ? 'bg-shuiro' : 'bg-tera'
                                  }`}
                                >
                                  {cand.type === 'shrine' ? '神社' : '寺院'}
                                </span>
                                {cand.prefecture && (
                                  <span className="px-1.5 py-0.5 rounded bg-kin/20 text-sumi font-serif font-bold text-[10px]">
                                    {cand.prefecture}
                                  </span>
                                )}
                                <span className="font-serif font-bold text-xs text-sumi">
                                  {cand.name}
                                </span>
                                {cand.distanceLabel && (
                                  <span className="text-[10px] font-semibold text-kin-dark bg-washi-dark px-1.5 py-0.2 rounded border border-kin/30">
                                    現在地から {cand.distanceLabel}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-sumi-muted mt-1 flex items-center gap-1 break-all">
                                <MapPin className="w-3 h-3 text-shuiro shrink-0" />
                                <span>{cand.address}</span>
                              </p>
                            </div>

                            <div className="shrink-0 self-center">
                              {isSelected ? (
                                <span className="inline-flex items-center gap-0.5 px-2 py-1 rounded-full bg-shuiro text-washi text-[10px] font-bold">
                                  <Check className="w-3 h-3" /> 選択中
                                </span>
                              ) : (
                                <span className="px-2 py-1 rounded-full bg-washi-dark border border-kin/40 text-sumi text-[10px] font-serif font-bold">
                                  選択
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 3. 参拝日（日付） */}
          <div className="space-y-1.5">
            <label className="font-serif font-bold text-sm flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-shuiro" />
              3. 参拝した日付（もらった日順で御朱印帳に並びます）
            </label>
            <input
              type="date"
              value={visitedDateIso}
              onChange={(e) => setVisitedDateIso(e.target.value)}
              className="w-full rounded-xl border border-washi-border bg-washi px-3.5 py-2.5 text-xs font-medium text-sumi focus:outline-none focus:border-shuiro"
            />
          </div>

          {/* 4. 場所（都道府県・市区町村・住所） */}
          <div className="space-y-1.5">
            <label className="font-serif font-bold text-sm flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-tera" />
              4. 場所・住所（上の候補を選ぶと自動入力されます）
            </label>
            <input
              type="text"
              value={addressText}
              onChange={(e) => setAddressText(e.target.value)}
              placeholder="例：兵庫県神戸市中央区下山手通1丁目（手入力・編集も可）"
              className="w-full rounded-xl border border-washi-border bg-washi px-3.5 py-2 text-xs text-sumi focus:outline-none focus:border-kin"
            />
          </div>

          {/* 5. ひとことメモ */}
          <div className="space-y-1.5">
            <label className="font-serif font-bold text-sm flex items-center gap-1.5">
              5. 思い出・ひとことメモ（任意）
            </label>
            <input
              type="text"
              value={memoText}
              onChange={(e) => setMemoText(e.target.value)}
              placeholder="例：家族旅行で参拝。限定の切り絵御朱印を拝受"
              className="w-full rounded-xl border border-washi-border bg-washi px-3.5 py-2 text-xs text-sumi focus:outline-none focus:border-kin"
            />
          </div>

          {/* 6. 実物の御朱印帳の選択 */}
          <div className="space-y-1.5">
            <label className="font-serif font-bold text-sm flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-kin-dark" />
              6. 収める御朱印帳（冊）（任意）
            </label>
            {books && books.length > 0 ? (
              <select
                value={selectedBookId}
                onChange={(e) => setSelectedBookId(e.target.value)}
                className="w-full rounded-xl border border-washi-border bg-washi px-3 py-2 text-xs text-sumi focus:outline-none focus:border-kin"
              >
                <option value="">未分類（全体の御朱印帳のみに表示）</option>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    📖 {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-sumi-muted bg-washi-dark/40 p-2.5 rounded-xl border border-washi-border">
                ※実物の御朱印帳（表紙・裏表紙登録）は、画面下の「御朱印帳」タブで作成できます。
              </p>
            )}
          </div>

          {/* 7. 巡拝グループ設定 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-serif font-bold text-sm flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-shuiro" />
                7. 巡拝グループ名（任意）
              </label>
              {suggestedGroup && groupNameText !== suggestedGroup && (
                <button
                  type="button"
                  onClick={() => setGroupNameText(suggestedGroup)}
                  className="text-[10px] text-shuiro font-bold bg-shuiro/10 hover:bg-shuiro/20 px-2 py-0.5 rounded-full border border-shuiro/30 transition flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  「{suggestedGroup}」を設定
                </button>
              )}
            </div>
            <input
              type="text"
              value={groupNameText}
              onChange={(e) => setGroupNameText(e.target.value)}
              placeholder="例：生田裔神八社めぐり、七福神めぐり など"
              className="w-full rounded-xl border border-washi-border bg-washi px-3.5 py-2 text-xs text-sumi focus:outline-none focus:border-kin"
            />
            <div className="pt-1 space-y-1">
              <p className="text-[10px] text-sumi-muted font-serif">
                候補からワンタップで選択:
              </p>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {existingGroupNames.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGroupNameText(g)}
                    className={`text-[10px] px-2 py-0.5 rounded-lg border transition ${
                      groupNameText === g
                        ? 'bg-shuiro text-washi border-shuiro font-bold'
                        : 'bg-washi border-kin/30 text-sumi-muted hover:text-sumi hover:border-shuiro/40'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 登録ボタン */}
          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-3.5 rounded-2xl bg-shuiro text-washi font-serif font-bold text-sm shadow-lg border border-kin/50 flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-60"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-kin" />
                <span>御朱印帳とマップに保存中...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4 text-kin" />
                <span>御朱印帳に登録する</span>
              </>
            )}
          </button>

          {/* キャンセル・戻るボタン */}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl bg-washi-dark/80 hover:bg-washi-dark text-sumi-muted hover:text-sumi font-serif font-bold text-xs border border-washi-border flex items-center justify-center gap-1.5 active:scale-95 transition shadow-sm"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-sumi-muted" />
            <span>キャンセルして前の画面に戻る</span>
          </button>
        </form>
      </div>
    </div>
  );
}
