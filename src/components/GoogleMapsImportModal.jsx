import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  ArrowLeft,
  Star,
  MapPin,
  ExternalLink,
  ClipboardPaste,
  Search,
  Loader2,
  Link2,
  CheckCircle2
} from 'lucide-react';
import {
  isGoogleMapsInput,
  resolveGoogleMapsShareToCandidates
} from '../services/googleMapsShareService.js';
import {
  saveFavoriteSpot,
  removeFavoriteSpot,
  extractPrefectureFromSpot
} from '../db/database.js';

/**
 * 本家Googleマップからの共有受け取り・URL/テキスト貼り付けによる「★お気に入り」取り込みモーダル
 */
export default function GoogleMapsImportModal({
  isOpen,
  onClose,
  initialSharePayload = null,
  allSpots = [],
  userLocation,
  favoriteMap = {},
  onImportedSpot
}) {
  const [rawInput, setRawInput] = useState('');
  const [manualName, setManualName] = useState('');
  const [needsManualName, setNeedsManualName] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [parsedInfo, setParsedInfo] = useState(null);
  const [isResolving, setIsResolving] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const skipNextAutoResolveRef = useRef(false);
  const latestSpotsRef = useRef(allSpots);
  const latestLocRef = useRef(userLocation);
  latestSpotsRef.current = allSpots;
  latestLocRef.current = userLocation;

  const runResolve = useCallback(async (payloadObj, manualOverride = '') => {
    const hasText = Boolean(
      payloadObj?.title || payloadObj?.text || payloadObj?.url || payloadObj?.rawText
    );
    if (!hasText && !manualOverride.trim()) {
      setCandidates([]);
      setParsedInfo(null);
      setNeedsManualName(false);
      return;
    }

    setIsResolving(true);
    setStatusNote('');
    try {
      const res = await resolveGoogleMapsShareToCandidates(
        payloadObj,
        latestSpotsRef.current,
        latestLocRef.current,
        manualOverride
      );
      setParsedInfo(res.parsed);
      setNeedsManualName(res.needsManualName);
      setCandidates(res.candidates || []);
    } catch {
      setCandidates([]);
      setStatusNote('解析中にエラーが発生しました。神社・お寺名でも検索できます。');
    } finally {
      setIsResolving(false);
    }
  }, []);

  // モーダルが開かれたとき・共有データが渡されたときに自動解析を実行
  useEffect(() => {
    if (!isOpen) return;
    if (initialSharePayload) {
      const combined = [
        initialSharePayload.title,
        initialSharePayload.text,
        initialSharePayload.url,
        initialSharePayload.rawText
      ]
        .filter(Boolean)
        .join('\n')
        .trim();
      skipNextAutoResolveRef.current = true;
      setRawInput(combined);
      setManualName('');
      runResolve(initialSharePayload, '');
    } else {
      setStatusNote('');
    }
  }, [isOpen, initialSharePayload, runResolve]);

  // 入力欄への直接ペースト／手入力時も自動で解析・候補表示
  useEffect(() => {
    if (!isOpen) return;
    if (skipNextAutoResolveRef.current) {
      skipNextAutoResolveRef.current = false;
      return;
    }
    const trimmedRaw = rawInput.trim();
    const trimmedManual = manualName.trim();
    if (!trimmedRaw && trimmedManual.length < 2) return;
    if (!isGoogleMapsInput(trimmedRaw) && trimmedRaw.length < 2 && trimmedManual.length < 2) {
      return;
    }

    const timer = setTimeout(() => {
      runResolve({ rawText: trimmedRaw }, trimmedManual);
    }, 320);
    return () => clearTimeout(timer);
  }, [isOpen, rawInput, manualName, runResolve]);

  if (!isOpen) return null;

  const handlePasteFromClipboard = async () => {
    setStatusNote('');
    try {
      if (!navigator.clipboard?.readText) {
        setStatusNote('下の入力欄を長押しして「ペースト」してください。');
        return;
      }
      const clip = (await navigator.clipboard.readText()) || '';
      if (!clip.trim()) {
        setStatusNote('クリップボードが空でした。本家Googleマップでリンクをコピーしてからお試しください。');
        return;
      }
      skipNextAutoResolveRef.current = true;
      setRawInput(clip.trim());
      setManualName('');
      runResolve({ rawText: clip.trim() }, '');
    } catch {
      setStatusNote('自動貼り付けが許可されませんでした。下の欄を長押しして「貼り付け」してください。');
    }
  };

  const handleManualResolve = (e) => {
    e?.preventDefault?.();
    runResolve({ rawText: rawInput.trim() }, manualName);
  };

  const toSpotObject = (cand) => ({
    ...cand,
    id: cand.id,
    name: cand.name,
    type: cand.type || 'shrine',
    denomination:
      cand.denomination || (cand.type === 'temple' ? '仏教（寺院）' : '神道（神社）'),
    address: cand.address || cand.prefecture || '',
    prefecture: cand.prefecture || extractPrefectureFromSpot(cand),
    lat: cand.lat,
    lng: cand.lng,
    distanceKm: cand.distanceKm,
    description:
      cand.description ||
      `${cand.name}（${cand.address || cand.prefecture || ''}）の参拝・御朱印スポットです。`,
    sampleGoshuin: cand.sampleGoshuin || [],
    hasGoshuin: true
  });

  const handleToggleFav = async (cand) => {
    const spotObj = toSpotObject(cand);
    if (favoriteMap[spotObj.id]) {
      await removeFavoriteSpot(spotObj.id);
    } else {
      await saveFavoriteSpot(spotObj);
    }
  };

  const handleSaveAndOpenMap = async (cand) => {
    const spotObj = toSpotObject(cand);
    await saveFavoriteSpot(spotObj);
    if (onImportedSpot) {
      onImportedSpot(spotObj);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-sm animate-fade-in">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 w-full max-w-[430px] max-h-[89vh] safe-modal-sheet washi-pattern rounded-t-3xl sm:rounded-3xl border-2 border-kin shadow-2xl flex flex-col overflow-hidden animate-slide-up">
        {/* ヘッダー */}
        <div className="bg-sumi text-washi px-4 py-3 border-b border-kin/40 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-washi text-xs font-serif font-bold shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>戻る</span>
          </button>

          <div className="flex items-center gap-1.5 min-w-0">
            <Link2 className="w-4 h-4 text-kin shrink-0" />
            <h2 className="font-serif font-bold text-sm truncate">
              Googleマップから追加
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-washi text-xs font-serif shrink-0"
          >
            <span>閉じる</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* スクロールコンテンツ */}
        <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-3.5">
          {/* 使い方＆本家Googleマップ起動ボタン */}
          <div className="rounded-2xl bg-washi-dark/80 border border-kin/40 p-3 space-y-2">
            <p className="text-[11px] text-sumi leading-relaxed">
              本家Googleマップで探した神社を
              <strong className="text-shuiro">「共有 → 御朱印めぐり」（Android）</strong>
              または
              <strong className="text-shuiro">「共有リンクをコピーして貼り付け」</strong>
              すると、そのまま ★お気に入り に追加できます。
            </p>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                '神社 寺院'
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2 px-3 rounded-xl bg-sumi text-kin border border-kin/60 text-xs font-serif font-bold flex items-center justify-center gap-1.5 shadow active:scale-95 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>本家Googleマップアプリを開いて探す</span>
            </a>
          </div>

          {/* 共有テキスト / URL 貼り付け入力欄 */}
          <form onSubmit={handleManualResolve} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-serif font-bold text-sumi">
                共有テキスト・GoogleマップURLを貼り付け:
              </label>
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                className="px-2.5 py-1 rounded-xl bg-amber-500 text-white text-[11px] font-serif font-bold flex items-center gap-1 shadow active:scale-95 transition shrink-0"
              >
                <ClipboardPaste className="w-3 h-3" />
                <span>貼り付け</span>
              </button>
            </div>

            <textarea
              rows={3}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="例: 生田神社 · 兵庫県神戸市... https://maps.app.goo.gl/... または GoogleマップのURL / 神社名"
              className="w-full rounded-xl border-2 border-kin/50 bg-washi px-3 py-2 text-xs text-sumi placeholder:text-sumi-muted/65 focus:outline-none focus:border-shuiro"
            />

            {needsManualName && (
              <div className="rounded-xl bg-amber-50 border border-amber-400 p-2.5 space-y-1.5">
                <p className="text-[11px] font-bold text-amber-900">
                  短縮URL（maps.app.goo.gl）単体のため、神社・お寺名も入力してください:
                </p>
                <input
                  type="text"
                  autoFocus
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="例: 生田神社、京都 八坂神社"
                  className="w-full rounded-lg border border-amber-400 bg-washi px-2.5 py-1.5 text-xs font-serif font-bold text-sumi focus:outline-none focus:border-shuiro"
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={isResolving || (!rawInput.trim() && !manualName.trim())}
                className="flex-1 py-2 px-3 rounded-xl bg-shuiro text-washi text-xs font-serif font-bold flex items-center justify-center gap-1.5 shadow active:scale-95 transition disabled:opacity-50"
              >
                {isResolving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-kin" />
                    <span>候補を検索中...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-3.5 h-3.5 text-kin" />
                    <span>URL・名前から候補を検索</span>
                  </>
                )}
              </button>

              {rawInput && (
                <button
                  type="button"
                  onClick={() => {
                    setRawInput('');
                    setManualName('');
                    setCandidates([]);
                    setParsedInfo(null);
                    setNeedsManualName(false);
                    setStatusNote('');
                  }}
                  className="px-3 py-2 rounded-xl bg-sumi/10 text-sumi text-xs font-serif font-bold"
                >
                  クリア
                </button>
              )}
            </div>

            {statusNote && (
              <p className="text-[11px] text-shuiro font-medium">{statusNote}</p>
            )}
          </form>

          {/* 解析できたキーワード・エリアヒント表示 */}
          {parsedInfo?.name && (
            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-sumi-muted">
              <span className="font-bold text-sumi">読み取り結果:</span>
              <span className="px-2 py-0.5 rounded-full bg-kin/25 text-sumi font-serif font-bold">
                {parsedInfo.name}
              </span>
              {parsedInfo.areaHint && (
                <span className="px-2 py-0.5 rounded-full bg-sumi/10 text-sumi font-serif">
                  {parsedInfo.areaHint}
                </span>
              )}
            </div>
          )}

          {/* 候補一覧 */}
          {candidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-serif font-bold text-sumi flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-tera" />
                <span>一致した候補（{candidates.length}件）</span>
              </p>

              <div className="space-y-2">
                {candidates.slice(0, 12).map((cand) => {
                  const isFav = Boolean(favoriteMap[cand.id]);
                  const pref = cand.prefecture || extractPrefectureFromSpot(cand);
                  return (
                    <div
                      key={cand.id}
                      className="rounded-2xl bg-washi border border-kin/50 p-3 shadow-sm space-y-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold text-washi ${
                              cand.type === 'temple' ? 'bg-tera' : 'bg-shuiro'
                            }`}
                          >
                            {cand.type === 'temple' ? '寺院' : '神社'}
                          </span>
                          {pref && (
                            <span className="px-1.5 py-0.2 rounded bg-kin/25 text-sumi font-serif font-bold text-[10px]">
                              {pref}
                            </span>
                          )}
                          <span className="font-serif font-bold text-sm text-sumi">
                            {cand.name}
                          </span>
                          {cand.distanceLabel && (
                            <span className="text-[10px] text-kin-dark font-medium">
                              ({cand.distanceLabel})
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-sumi-muted mt-1 flex items-start gap-1">
                          <MapPin className="w-3 h-3 text-shuiro shrink-0 mt-0.5" />
                          <span>{cand.address}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleToggleFav(cand)}
                          className={`flex-1 py-1.5 px-2.5 rounded-xl border text-xs font-serif font-bold flex items-center justify-center gap-1 active:scale-95 transition ${
                            isFav
                              ? 'bg-amber-500 text-white border-amber-600 shadow'
                              : 'bg-washi hover:bg-amber-50 text-sumi border-kin'
                          }`}
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              isFav ? 'fill-white text-white' : 'text-amber-500'
                            }`}
                          />
                          <span>{isFav ? '★ お気に入り済' : '★ お気に入り追加'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSaveAndOpenMap(cand)}
                          className="py-1.5 px-3 rounded-xl bg-sumi text-kin border border-kin/50 text-xs font-serif font-bold flex items-center gap-1 active:scale-95 transition shrink-0"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          <span>追加して地図へ</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!isResolving && parsedInfo && !needsManualName && candidates.length === 0 && (
            <div className="rounded-xl bg-washi-dark/70 border border-kin/40 p-3 text-center text-xs text-sumi-muted">
              一致する候補が見つかりませんでした。社寺名を少し短くして再検索してみてください。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
