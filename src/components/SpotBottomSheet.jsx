import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  X,
  MapPin,
  Camera,
  Stamp,
  Sparkles,
  Trash2,
  NotebookPen,
  Check,
  ExternalLink,
  Loader2,
  BookOpenCheck,
  Wand2,
  Image as ImageIcon,
  Globe,
  Search,
  Calendar,
  RotateCw,
  ZoomIn,
  PlusCircle,
  FolderPlus,
  Book,
  Tag,
  ChevronLeft
} from 'lucide-react';
import GoshuinSampleGraphic from './GoshuinSampleGraphic.jsx';
import GoshuinPhotoLightbox from './GoshuinPhotoLightbox.jsx';
import {
  saveVisitRecord,
  deleteVisitRecord,
  compressImageToBase64,
  rotateBase64Image90,
  getPlaceId,
  createAdditionalEntryId,
  suggestGroupNameForSpot,
  getAllCustomGroupNames
} from '../db/database.js';
import {
  generateSpotAiGuide,
  analyzeGoshuinPhotoWithAi,
  getGeminiApiKey
} from '../services/geminiService.js';
import {
  fetchRealWebPhotos,
  buildRealGoshuinLinks
} from '../services/realGoshuinService.js';
import { useBackHandler } from '../contexts/BackHandlerContext.jsx';

/**
 * ピンまたはカードをタップした際に画面下部からスムーズにスライドアップする
 * 「実物Web写真＆Instagram/Google画像/ホトカミ連携・参拝日付編集・Gemini 3.8 Flash AI調査ボトムシート」
 * ★同じ社寺の複数御朱印登録・巡拝グループ分け・実物御朱印帳への振り分けに対応
 */
export default function SpotBottomSheet({
  spot,
  visitRecord,
  allVisits = [],
  books = [],
  onClose,
  onSaved,
  onOpenAiSettings
}) {
  // この社寺でいただいた全御朱印レコード
  const placeVisits = React.useMemo(() => {
    if (!spot?.id) return [];
    const list = allVisits.filter(
      (v) => (v.placeId || v.spotId) === spot.id || v.spotId === spot.id
    );
    if (list.length === 0 && visitRecord) {
      return [visitRecord];
    }
    return list;
  }, [allVisits, spot?.id, visitRecord]);

  // 現在選択されている御朱印のエントリーID
  const [selectedEntryId, setSelectedEntryId] = useState(
    () => visitRecord?.spotId || spot?.id || ''
  );

  useEffect(() => {
    if (placeVisits.length > 0) {
      const exists = placeVisits.find((v) => v.spotId === selectedEntryId);
      if (!exists) {
        setSelectedEntryId(placeVisits[0].spotId);
      }
    } else {
      setSelectedEntryId(spot?.id || '');
    }
  }, [spot?.id, placeVisits]);

  // 現在表示中の御朱印レコード
  const activeRecord =
    placeVisits.find((v) => v.spotId === selectedEntryId) ||
    visitRecord ||
    null;

  const [justStamped, setJustStamped] = useState(false);
  const [memoText, setMemoText] = useState('');
  const [visitedDateText, setVisitedDateText] = useState('');
  const [groupNameText, setGroupNameText] = useState('');
  const [selectedBookId, setSelectedBookId] = useState('');
  const [isSavingMemo, setIsSavingMemo] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // 写真拡大ライトボックスが開いている場合、戻るボタンで閉じる（優先度20）
  useBackHandler({
    id: 'spot-photo-lightbox',
    isOpen: isLightboxOpen,
    onBack: () => setIsLightboxOpen(false),
    priority: 20
  });

  // Web上の実在写真ステート
  const [webPhotos, setWebPhotos] = useState([]);
  const [isLoadingWebPhotos, setIsLoadingWebPhotos] = useState(false);

  // AI機能用のローディング・エラーステート
  const [isGeneratingGuide, setIsGeneratingGuide] = useState(false);
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false);
  const [aiError, setAiError] = useState('');

  const fileInputRef = useRef(null);

  const isVisited = Boolean(activeRecord?.visited);
  const photoDataUrl = activeRecord?.photoDataUrl || null;
  const aiSpotGuide = activeRecord?.aiSpotGuide || null;
  const aiPhotoAnalysis = activeRecord?.aiPhotoAnalysis || null;
  const isShrine = spot?.type === 'shrine';

  useEffect(() => {
    setMemoText(activeRecord?.memo || '');
    setGroupNameText(activeRecord?.groupName || '');
    setSelectedBookId(activeRecord?.bookId || '');
    const todayStr = new Date().toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    setVisitedDateText(activeRecord?.visitedDate || todayStr);
    setJustStamped(false);
    setAiError('');
  }, [activeRecord?.spotId, activeRecord?.memo, activeRecord?.visitedDate, activeRecord?.groupName, activeRecord?.bookId]);

  // スポットを開いたときにWeb上の実在写真（Wikimedia / Wikipedia公開写真）を自動検索
  useEffect(() => {
    let active = true;
    if (!spot?.name) {
      setWebPhotos([]);
      return;
    }
    setIsLoadingWebPhotos(true);
    fetchRealWebPhotos(spot.name)
      .then((photos) => {
        if (active) setWebPhotos(photos);
      })
      .finally(() => {
        if (active) setIsLoadingWebPhotos(false);
      });

    return () => {
      active = false;
    };
  }, [spot?.id, spot?.name]);

  if (!spot) return null;

  // 紙吹雪（朱色・金色・和紙色）を舞わせる演出
  const triggerCelebrationConfetti = () => {
    confetti({
      particleCount: 65,
      spread: 70,
      origin: { y: 0.72 },
      colors: ['#c93a40', '#c5a059', '#fcfaf2', '#e6b422']
    });
  };

  // 現在対象のスポットオブジェクト（社寺IDとレコード個別IDを正確に紐付け）
  const currentSpotTarget = {
    ...spot,
    id: activeRecord?.spotId || spot.id,
    placeId: spot.id
  };

  // 「参拝済みにする」トグル処理
  const handleToggleVisited = async () => {
    const nextVisited = !isVisited;
    if (nextVisited) {
      setJustStamped(true);
      triggerCelebrationConfetti();
    } else {
      setJustStamped(false);
    }

    const updated = await saveVisitRecord(currentSpotTarget, {
      visited: nextVisited,
      visitedDate: visitedDateText,
      memo: memoText,
      groupName: groupNameText.trim(),
      bookId: selectedBookId,
      placeId: spot.id
    });
    if (onSaved) onSaved(updated);
  };

  // 新しくこの社寺の2枚目・3枚目の御朱印を追加する処理
  const handleAddNewEntryForSameSpot = async () => {
    const newEntryId = createAdditionalEntryId(spot.id);
    const todayStr = new Date().toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const newRecord = await saveVisitRecord(
      {
        ...spot,
        id: newEntryId,
        placeId: spot.id
      },
      {
        visited: true,
        visitedDate: todayStr,
        memo: '',
        photoDataUrl: null,
        placeId: spot.id,
        bookId: selectedBookId,
        groupName: groupNameText.trim()
      }
    );
    setSelectedEntryId(newEntryId);
    setMemoText('');
    setVisitedDateText(todayStr);
    setJustStamped(true);
    triggerCelebrationConfetti();
    if (onSaved) onSaved(newRecord);
  };

  // 選択中の御朱印記録を削除する処理
  const handleDeleteCurrentEntry = async () => {
    const targetId = activeRecord?.spotId || spot.id;
    const ok = window.confirm(
      `この御朱印記録を削除しますか？\n（※登録した写真やメモが削除されます）`
    );
    if (!ok) return;
    await deleteVisitRecord(targetId);
    if (placeVisits.length <= 1) {
      onClose();
    } else {
      const remaining = placeVisits.filter((v) => v.spotId !== targetId);
      if (remaining.length > 0) setSelectedEntryId(remaining[0].spotId);
    }
  };

  // カレンダーから参拝日を変更した際の処理
  const handleDatePickerChange = async (e) => {
    const iso = e.target.value;
    if (!iso) return;
    const parts = iso.split('-');
    const formatted =
      parts.length === 3
        ? `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`
        : iso;
    setVisitedDateText(formatted);

    const updated = await saveVisitRecord(currentSpotTarget, {
      visited: true,
      visitedDate: formatted,
      memo: memoText,
      groupName: groupNameText.trim(),
      bookId: selectedBookId,
      placeId: spot.id
    });
    if (onSaved) onSaved(updated);
  };

  // カメラ撮影・ギャラリー画像のアップロード処理（IndexedDBへ永続化）
  const handlePhotoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const base64Url = await compressImageToBase64(file);
      setJustStamped(true);
      triggerCelebrationConfetti();

      const updated = await saveVisitRecord(currentSpotTarget, {
        visited: true,
        visitedDate: visitedDateText,
        photoDataUrl: base64Url,
        memo: memoText,
        groupName: groupNameText.trim(),
        bookId: selectedBookId,
        placeId: spot.id
      });
      if (onSaved) onSaved(updated);
    } catch (error) {
      console.error('写真の保存に失敗しました:', error);
      alert('画像の読み込みに失敗しました。別の画像をお試しください。');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 登録済み写真の削除
  const handleRemovePhoto = async () => {
    const updated = await saveVisitRecord(currentSpotTarget, {
      photoDataUrl: null,
      aiPhotoAnalysis: null
    });
    if (onSaved) onSaved(updated);
  };

  // 登録済み写真を90°回転して保存（見開き御朱印を横向きにする等）
  const handleRotatePhoto90 = async () => {
    if (!photoDataUrl || isRotating) return;
    try {
      setIsRotating(true);
      const rotated = await rotateBase64Image90(photoDataUrl, true);
      const updated = await saveVisitRecord(currentSpotTarget, {
        photoDataUrl: rotated
      });
      if (onSaved) onSaved(updated);
    } finally {
      setIsRotating(false);
    }
  };

  // 参拝メモ・所属グループ・御朱印帳の保存
  const handleSaveMemoAndMeta = async (customMemo) => {
    const targetText = typeof customMemo === 'string' ? customMemo : memoText.trim();
    setIsSavingMemo(true);
    const updated = await saveVisitRecord(currentSpotTarget, {
      visited: isVisited || Boolean(targetText) || Boolean(photoDataUrl),
      visitedDate: visitedDateText,
      memo: targetText,
      groupName: groupNameText.trim(),
      bookId: selectedBookId,
      placeId: spot.id
    });
    setTimeout(() => setIsSavingMemo(false), 600);
    if (onSaved) onSaved(updated);
  };

  // Gemini AI機能1: 登録した御朱印写真の墨書・朱印をマルチモーダル解読
  const handleAnalyzePhotoWithAi = async () => {
    setAiError('');
    if (!getGeminiApiKey()) {
      onOpenAiSettings();
      return;
    }
    if (!photoDataUrl) return;

    try {
      setIsAnalyzingPhoto(true);
      const analysis = await analyzeGoshuinPhotoWithAi(spot, photoDataUrl);
      const nextMemo = memoText.trim() || analysis.summaryForMemo || '';
      setMemoText(nextMemo);

      const updated = await saveVisitRecord(currentSpotTarget, {
        visited: true,
        visitedDate: visitedDateText,
        aiPhotoAnalysis: analysis,
        memo: nextMemo,
        groupName: groupNameText.trim(),
        bookId: selectedBookId,
        placeId: spot.id
      });
      if (onSaved) onSaved(updated);
    } catch (err) {
      if (err.message === 'API_KEY_MISSING') {
        onOpenAiSettings();
      } else {
        setAiError(err.message || '御朱印写真のAI鑑定に失敗しました。');
      }
    } finally {
      setIsAnalyzingPhoto(false);
    }
  };

  // Gemini AI機能2: この寺社でもらえる実際の御朱印情報・由緒・Web情報をGemini 3.8 Flash + Google検索で調査
  const handleGenerateSpotGuide = async () => {
    setAiError('');
    if (!getGeminiApiKey()) {
      onOpenAiSettings();
      return;
    }

    try {
      setIsGeneratingGuide(true);
      const guide = await generateSpotAiGuide(spot);
      const updated = await saveVisitRecord(spot, {
        aiSpotGuide: guide
      });
      if (onSaved) onSaved(updated);
    } catch (err) {
      if (err.message === 'API_KEY_MISSING') {
        onOpenAiSettings();
      } else {
        setAiError(err.message || 'AI御朱印・寺社調査に失敗しました。');
      }
    } finally {
      setIsGeneratingGuide(false);
    }
  };

  const samples = spot.sampleGoshuin || [];
  const realGoshuinLinks = buildRealGoshuinLinks(spot);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-sumi/60 backdrop-blur-[2px] transition-opacity">
      {/* 背景タップで閉じる */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* ボトムシート本体（スマホ幅最適化） */}
      <div className="relative z-10 w-full max-w-[430px] max-h-[89vh] washi-pattern rounded-t-3xl border-t-2 border-kin shadow-2xl flex flex-col animate-slide-up overflow-hidden">
        {/* 上部ドラッグバー＆ヘッダー */}
        <div className="pt-2.5 pb-3 px-5 bg-washi/95 border-b border-washi-border shrink-0">
          <div className="w-12 h-1.5 bg-sumi/20 rounded-full mx-auto mb-3" />

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold text-washi ${
                    isShrine ? 'bg-shuiro' : 'bg-tera'
                  }`}
                >
                  {isShrine ? '神社' : '寺院'}
                </span>
                <span className="text-xs font-medium text-sumi-muted">
                  {spot.denomination}
                </span>
                {spot.distanceKm != null && (
                  <span className="text-xs font-semibold text-kin-dark">
                    現在地から {spot.distanceKm}km
                  </span>
                )}
              </div>

              <h2 className="font-serif font-black text-xl text-sumi tracking-wide">
                {spot.name}
              </h2>
              {spot.reading && (
                <p className="text-[11px] text-sumi-muted">{spot.reading}</p>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sumi/10 hover:bg-sumi/20 text-sumi text-xs font-serif font-bold transition shrink-0 active:scale-95 border border-sumi/20"
              title="閉じる"
            >
              <span>閉じる</span>
              <X className="w-4 h-4 text-sumi" />
            </button>
          </div>
        </div>

        {/* スクロール可能なコンテンツ領域 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {aiError && (
            <div className="p-3 rounded-xl bg-shuiro-light border border-shuiro text-xs text-shuiro font-medium">
              {aiError}
            </div>
          )}

          {/* ★同じ神社・お寺でいただいた御朱印の複数管理タブ＆新規追加 */}
          <div className="rounded-2xl bg-washi border border-kin/50 p-2.5 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-serif font-bold text-sumi flex items-center gap-1">
                <Book className="w-3.5 h-3.5 text-shuiro" />
                この社寺の御朱印記録 ({placeVisits.length}枚)
              </span>
              <button
                type="button"
                onClick={handleAddNewEntryForSameSpot}
                className="px-2.5 py-1 rounded-xl bg-shuiro/10 hover:bg-shuiro/20 text-shuiro border border-shuiro/40 text-[10px] font-serif font-bold flex items-center gap-1 active:scale-95 transition"
                title="同じ神社・お寺で別の御朱印（限定御朱印や別日付）を追加"
              >
                <PlusCircle className="w-3 h-3 text-shuiro" />
                <span>＋ 別の御朱印を追加</span>
              </button>
            </div>

            {placeVisits.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar pt-1">
                {placeVisits.map((v, idx) => {
                  const isCur = v.spotId === selectedEntryId;
                  const label = v.memo ? `「${v.memo.slice(0, 6)}」` : `御朱印 ${idx + 1}`;
                  return (
                    <button
                      key={v.spotId}
                      type="button"
                      onClick={() => setSelectedEntryId(v.spotId)}
                      className={`px-3 py-1 rounded-xl text-xs font-serif font-bold transition whitespace-nowrap flex items-center gap-1 ${
                        isCur
                          ? 'bg-shuiro text-washi shadow-sm'
                          : 'bg-washi-dark text-sumi-muted border border-washi-border hover:bg-washi'
                      }`}
                    >
                      <span>{label}</span>
                      {v.photoDataUrl && <span className="text-[10px]">📷</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 参拝チェック・過去日付設定＆朱色落款印スタンプエリア */}
          <div className="relative rounded-2xl bg-washi-dark/80 border border-kin/40 p-4 shadow-inner overflow-hidden space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-sumi-muted mb-0.5">
                  参拝ステータス
                </p>
                <p className="font-serif font-bold text-sm text-sumi">
                  {isVisited
                    ? `参拝済み（${visitedDateText}）`
                    : 'まだ参拝記録がありません'}
                </p>
              </div>

              <button
                type="button"
                onClick={handleToggleVisited}
                className={`px-4 py-2.5 rounded-xl font-serif font-bold text-sm flex items-center gap-2 shadow-md transition active:scale-95 ${
                  isVisited
                    ? 'bg-shuiro text-washi border border-shuiro-dark'
                    : 'bg-sumi text-kin border border-kin/50 hover:bg-sumi-light'
                }`}
              >
                <Stamp className="w-4 h-4" />
                {isVisited ? '参拝済み（解除可）' : '参拝済みにする'}
              </button>
            </div>

            {/* 参拝日（過去の日付変更）ピッカー */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-washi-border text-xs">
              <span className="font-serif font-bold text-sumi flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-shuiro" />
                参拝日を指定（過去の参拝も可）:
              </span>
              <input
                type="date"
                onChange={handleDatePickerChange}
                className="rounded-lg border border-kin/50 bg-washi px-2.5 py-1 text-xs text-sumi focus:outline-none focus:border-shuiro"
              />
            </div>

            {/* ★納める実物御朱印帳（冊）の選択 */}
            <div className="pt-2 border-t border-washi-border space-y-1.5 text-xs">
              <label className="font-serif font-bold text-sumi flex items-center gap-1.5">
                <Book className="w-3.5 h-3.5 text-kin-dark" />
                納める実物御朱印帳（冊）を指定:
              </label>
              <select
                value={selectedBookId}
                onChange={(e) => {
                  setSelectedBookId(e.target.value);
                  saveVisitRecord(currentSpotTarget, {
                    bookId: e.target.value
                  }).then((u) => onSaved && onSaved(u));
                }}
                className="w-full rounded-xl border border-kin/40 bg-washi px-3 py-1.5 text-xs font-serif font-bold text-sumi focus:outline-none focus:border-shuiro"
              >
                <option value="">（全体の御朱印帳・未分類）</option>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    📖 {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* ★巡拝グループ（例: 生田裔神八社めぐり、七福神めぐり など）の指定 */}
            <div className="pt-2 border-t border-washi-border space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <label className="font-serif font-bold text-sumi flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-shuiro" />
                  巡拝グループ（八社めぐり等）:
                </label>
                {suggestGroupNameForSpot(spot.name) && (
                  <button
                    type="button"
                    onClick={() => {
                      const sg = suggestGroupNameForSpot(spot.name);
                      setGroupNameText(sg);
                      saveVisitRecord(currentSpotTarget, {
                        groupName: sg
                      }).then((u) => onSaved && onSaved(u));
                    }}
                    className="text-[10px] text-shuiro font-serif font-bold bg-shuiro/10 px-2 py-0.5 rounded-md hover:bg-shuiro/20"
                  >
                    ✦ おすすめ「{suggestGroupNameForSpot(spot.name).slice(0, 8)}…」を適用
                  </button>
                )}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={groupNameText}
                  onChange={(e) => setGroupNameText(e.target.value)}
                  placeholder="例：生田裔神八社めぐり、七福神めぐり など"
                  className="flex-1 rounded-xl border border-kin/40 bg-washi px-3 py-1.5 text-xs font-serif text-sumi focus:outline-none focus:border-shuiro"
                />
                <button
                  type="button"
                  onClick={() => {
                    saveVisitRecord(currentSpotTarget, {
                      groupName: groupNameText.trim()
                    }).then((u) => onSaved && onSaved(u));
                  }}
                  className="px-3 py-1 rounded-xl bg-sumi text-kin text-xs font-bold shrink-0"
                >
                  反映
                </button>
              </div>

              {/* 既存・登録済みの巡拝グループ候補チップ */}
              {getAllCustomGroupNames(allVisits).length > 0 && (
                <div className="pt-1 space-y-1">
                  <p className="text-[10px] text-sumi-muted font-serif">
                    候補から選択:
                  </p>
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                    {getAllCustomGroupNames(allVisits).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          setGroupNameText(g);
                          saveVisitRecord(currentSpotTarget, {
                            groupName: g
                          }).then((u) => onSaved && onSaved(u));
                        }}
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
              )}
            </div>

            {isVisited && (
              <div
                key={justStamped ? 'stamped-fresh' : 'stamped-static'}
                className={`space-y-2.5 p-2.5 rounded-xl bg-shuiro-light border border-shuiro/30 ${
                  justStamped ? 'animate-stamp-pop' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg border-2 border-shuiro flex flex-col items-center justify-center bg-washi text-shuiro font-serif font-black leading-none shrink-0 shadow-sm rotate-[-8deg]">
                    <span className="text-[10px]">奉拝</span>
                    <span className="text-sm mt-0.5">参拝済</span>
                  </div>
                  <div className="text-xs text-sumi flex-1">
                    <p className="font-serif font-bold text-shuiro">
                      御朱印帳に参拝印が刻まれました（{visitedDateText}）
                    </p>
                    <p className="text-[11px] text-sumi-muted mt-0.5">
                      御朱印の写真を登録すると、Gemini 3.8 Flashで墨書の意味も解読できます。
                    </p>
                  </div>
                </div>

                <div className="flex justify-end pt-1 border-t border-shuiro/20">
                  <button
                    type="button"
                    onClick={handleDeleteCurrentEntry}
                    className="px-3 py-1.5 rounded-lg bg-washi hover:bg-shuiro hover:text-washi text-shuiro border border-shuiro/40 text-xs font-serif font-bold flex items-center gap-1.5 transition active:scale-95"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>この御朱印記録を削除する</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 自分の御朱印写真を登録＆AI墨書鑑定 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-serif font-bold text-sm text-sumi flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-shuiro" />
                自分が頂いた御朱印写真（端末保存＆AI鑑定）
              </h3>
              {photoDataUrl && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="text-xs text-shuiro flex items-center gap-1 hover:underline"
                >
                  <Trash2 className="w-3.5 h-3.5" /> 写真を削除
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              className="hidden"
            />

            {photoDataUrl ? (
              <div className="space-y-3">
                <div className="jabara-card p-3 rounded-2xl space-y-2.5">
                  <div
                    onClick={() => setIsLightboxOpen(true)}
                    className="relative w-full max-h-56 rounded-xl overflow-hidden bg-washi-dark border border-kin/50 flex items-center justify-center p-1.5 shadow-inner cursor-zoom-in group"
                    title="タップして御朱印をアップで拡大表示"
                  >
                    <img
                      src={photoDataUrl}
                      alt={`${spot.name}の御朱印写真`}
                      className="w-full max-h-52 object-contain rounded-lg group-hover:scale-[1.02] transition"
                    />
                    <div className="absolute bottom-2 right-2 px-2.5 py-1 rounded-full bg-sumi/85 text-kin border border-kin/50 text-[10px] font-serif font-bold flex items-center gap-1 shadow">
                      <ZoomIn className="w-3 h-3" />
                      <span>タップでアップ表示</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-kin/20 text-kin-dark text-[11px] font-bold">
                        <Sparkles className="w-3 h-3" /> マイ御朱印帳に登録済
                      </span>
                      <button
                        type="button"
                        disabled={isRotating}
                        onClick={handleRotatePhoto90}
                        className="px-2.5 py-1 rounded-lg bg-washi border border-kin text-sumi font-serif font-bold text-[11px] flex items-center gap-1 shadow-sm active:scale-95 transition"
                      >
                        <RotateCw
                          className={`w-3 h-3 text-shuiro ${
                            isRotating ? 'animate-spin' : ''
                          }`}
                        />
                        <span>90°回転（見開き横向き）</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={isAnalyzingPhoto}
                      onClick={handleAnalyzePhotoWithAi}
                      className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-shuiro to-shuiro-dark text-washi text-xs font-serif font-bold flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition disabled:opacity-60"
                    >
                      {isAnalyzingPhoto ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-kin" />
                          AIが墨書・朱印を鑑定中...
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-3.5 h-3.5 text-kin" />
                          {aiPhotoAnalysis ? 'AIで再鑑定する' : 'AIで御朱印の文字を解読'}
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-1.5 px-3 rounded-xl bg-sumi text-washi text-[11px] font-bold flex items-center justify-center gap-1.5"
                    >
                      <Camera className="w-3 h-3 text-kin" />
                      別の写真に変更
                    </button>
                  </div>
                </div>

                {aiPhotoAnalysis && (
                  <div className="rounded-2xl bg-washi border-2 border-kin p-3.5 shadow-md space-y-2 text-xs">
                    <div className="flex items-center justify-between border-b border-washi-border pb-2">
                      <span className="font-serif font-black text-sm text-sumi flex items-center gap-1.5">
                        <BookOpenCheck className="w-4 h-4 text-shuiro" />
                        Gemini AI 御朱印鑑定書
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-kin/20 text-kin-dark font-bold">
                        端末保存済
                      </span>
                    </div>

                    <div>
                      <span className="font-bold text-shuiro">【墨書（揮毫）の解読】</span>
                      <p className="text-sumi mt-0.5 leading-relaxed">
                        {aiPhotoAnalysis.calligraphyReading}
                      </p>
                    </div>
                    <div>
                      <span className="font-bold text-kin-dark">【朱印・印章の読み取り】</span>
                      <p className="text-sumi mt-0.5 leading-relaxed">
                        {aiPhotoAnalysis.sealReading}
                      </p>
                    </div>
                    <div>
                      <span className="font-bold text-tera">【言葉の意味・ご利益】</span>
                      <p className="text-sumi mt-0.5 leading-relaxed">
                        {aiPhotoAnalysis.meaningAndBlessing}
                      </p>
                    </div>
                    <div className="pt-1 border-t border-washi-border text-[11px] text-sumi-muted italic">
                      書風評: {aiPhotoAnalysis.artisticImpression}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-4 px-4 rounded-2xl border-2 border-dashed border-kin bg-washi hover:bg-washi-dark/60 transition flex flex-col items-center justify-center gap-1.5 shadow-sm active:scale-[0.99]"
              >
                <div className="w-10 h-10 rounded-full bg-shuiro/10 text-shuiro flex items-center justify-center">
                  <Camera className="w-5 h-5" />
                </div>
                <span className="font-serif font-bold text-sm text-sumi">
                  {isUploading ? '写真を圧縮・保存中...' : '自分の御朱印写真を登録する'}
                </span>
                <span className="text-[11px] text-sumi-muted">
                  カメラ撮影またはアルバムから選択（登録後にAI墨書解読も使えます）
                </span>
              </button>
            )}
          </div>

          {/* Instagram・Google画像・ホトカミ等で「実際にもらえる本物の御朱印写真」を見るセクション */}
          <div className="rounded-2xl bg-washi border-2 border-kin/60 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-serif font-black text-sm text-sumi flex items-center gap-1.5">
                <Search className="w-4 h-4 text-shuiro" />
                SNS・Webで「実際にもらえる御朱印写真」を見る
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-shuiro/10 text-shuiro font-bold">
                実物投稿
              </span>
            </div>

            <p className="text-[11px] text-sumi-muted leading-relaxed">
              「{spot.name}」で参拝者が実際に拝受して投稿している本物の御朱印写真（通常・季節限定・切り絵など）をワンタップで確認できます。
            </p>

            {isLoadingWebPhotos ? (
              <div className="flex items-center gap-2 text-xs text-sumi-muted py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-kin-dark" />
                <span>Web公開写真を検索中...</span>
              </div>
            ) : webPhotos.length > 0 ? (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-kin-dark flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" /> Web公開されている「{spot.name}」の実物写真
                </span>
                <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
                  {webPhotos.map((photo, idx) => (
                    <a
                      key={idx}
                      href={photo.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 w-36 rounded-xl overflow-hidden border border-washi-border bg-washi-dark shadow-sm group"
                    >
                      <img
                        src={photo.url}
                        alt={photo.title}
                        className="w-36 h-24 object-cover group-hover:scale-105 transition"
                      />
                      <p className="text-[10px] text-sumi truncate px-2 py-1 font-medium">
                        {photo.title}
                      </p>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 pt-1">
              {realGoshuinLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2.5 rounded-xl border border-washi-border bg-washi-dark/70 hover:border-kin transition flex flex-col justify-between group"
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${link.badgeColor}`}
                    >
                      {link.label.split('（')[0]}
                    </span>
                    <ExternalLink className="w-3 h-3 text-sumi-muted group-hover:text-shuiro shrink-0" />
                  </div>
                  <p className="text-[11px] font-serif font-bold text-sumi leading-tight">
                    {link.subLabel}
                  </p>
                </a>
              ))}
            </div>
          </div>

          {/* Gemini 3.8 Flash + Google検索による「実在御朱印レポート＆寺社深掘り調査」 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-serif font-bold text-sm text-sumi flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-shuiro" />
                AI＋Web検索で「もらえる御朱印の種類」を調査
              </h3>
            </div>

            {aiSpotGuide ? (
              <div className="rounded-2xl bg-washi border-2 border-kin p-4 space-y-3 text-xs shadow-sm">
                {Array.isArray(aiSpotGuide.realGoshuinList) &&
                  aiSpotGuide.realGoshuinList.length > 0 && (
                    <div className="space-y-2">
                      <span className="font-serif font-black text-xs text-shuiro block">
                        📖 Web・SNSで確認されている授与御朱印レポート
                      </span>
                      {aiSpotGuide.realGoshuinList.map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-xl bg-washi-dark border border-kin/40 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-serif font-bold text-sm text-sumi">
                              {item.name}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-shuiro/10 text-shuiro font-bold shrink-0">
                              {item.feeAndStyle}
                            </span>
                          </div>
                          <p className="text-xs text-sumi-muted leading-relaxed">
                            {item.visualDetail}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                {aiSpotGuide.webSearchSummary && (
                  <div className="p-3 rounded-xl bg-washi-dark/60 border border-washi-border space-y-1.5">
                    <span className="font-serif font-bold text-xs text-kin-dark block">
                      🔍 Googleリアルタイム検索結果まとめ
                    </span>
                    <p className="text-xs text-sumi leading-relaxed whitespace-pre-line">
                      {aiSpotGuide.webSearchSummary}
                    </p>
                    {Array.isArray(aiSpotGuide.webSources) &&
                      aiSpotGuide.webSources.length > 0 && (
                        <div className="pt-1.5 flex flex-wrap gap-1.5">
                          {aiSpotGuide.webSources.slice(0, 4).map((src, i) => (
                            <a
                              key={i}
                              href={src.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sumi text-kin text-[10px] hover:underline"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              <span className="truncate max-w-[150px]">{src.title}</span>
                            </a>
                          ))}
                        </div>
                      )}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(aiSpotGuide.blessings || []).map((b, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-0.5 rounded-full bg-shuiro/10 text-shuiro border border-shuiro/30 font-serif font-bold text-[11px]"
                    >
                      ✦ {b}
                    </span>
                  ))}
                </div>

                <div>
                  <span className="font-bold text-sumi">
                    ■ {isShrine ? '御祭神' : '御本尊'}:
                  </span>{' '}
                  <span className="text-sumi-muted">{aiSpotGuide.deityOrBuddha}</span>
                </div>

                <div>
                  <span className="font-bold text-sumi">■ 由緒と見どころ:</span>
                  <p className="text-sumi-muted mt-0.5 leading-relaxed">
                    {aiSpotGuide.historyAndHighlights}
                  </p>
                </div>

                <div className="p-2.5 rounded-xl bg-washi-dark border border-kin/30">
                  <span className="font-serif font-bold text-kin-dark block mb-0.5">
                    🖌️ 受付・拝受アドバイス（代表揮毫:「{aiSpotGuide.recommendedCalligraphy}」）
                  </span>
                  <p className="text-sumi-muted leading-relaxed">
                    {aiSpotGuide.goshuinAdvice}
                  </p>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={isGeneratingGuide}
                onClick={handleGenerateSpotGuide}
                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-sumi to-sumi-light text-washi border border-kin shadow-md flex items-center justify-center gap-2 font-serif font-bold text-xs active:scale-95 transition disabled:opacity-60"
              >
                {isGeneratingGuide ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-kin" />
                    <span>Gemini 3.8 FlashがWeb上の御朱印情報を検索・調査中...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-kin" />
                    <span>AI＋Web検索で「{spot.name}」の実在御朱印・初穂料・由緒を調べる</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* 伝統書式イメージ見本（参考） */}
          <div className="space-y-2.5">
            <h3 className="font-serif font-bold text-sm text-sumi flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-kin-dark" />
              代表的な揮毫・墨書レイアウト見本
            </h3>

            <div className="space-y-3">
              {samples.map((sample) => (
                <div
                  key={sample.id}
                  className="rounded-2xl bg-washi border border-washi-border p-3.5 shadow-sm flex gap-3.5 items-center"
                >
                  <GoshuinSampleGraphic sample={sample} spotType={spot.type} compact />

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="px-2 py-0.5 rounded bg-kin/20 text-kin-dark text-[10px] font-bold">
                        {sample.badge}
                      </span>
                      <span className="text-[11px] font-semibold text-shuiro">
                        {sample.fee}
                      </span>
                    </div>
                    <h4 className="font-serif font-bold text-sm text-sumi leading-snug">
                      {sample.title}
                    </h4>
                    <p className="text-xs text-sumi-muted mt-1.5 leading-relaxed">
                      {sample.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 由緒・所在地情報＆Googleマップアプリ連携 */}
          <div className="rounded-2xl bg-washi border border-washi-border p-3.5 space-y-2 text-xs">
            <p className="text-sumi leading-relaxed">{spot.description}</p>
            <div className="pt-2 border-t border-washi-border flex items-center justify-between gap-2 text-sumi-muted">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-shuiro shrink-0" />
                {spot.address}
              </span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${spot.name} ${spot.address}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-shuiro text-washi font-bold shrink-0 hover:opacity-90"
              >
                Googleマップで開く <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* 参拝メモ入力欄 */}
          <div className="space-y-2 pb-2">
            <label className="font-serif font-bold text-sm text-sumi flex items-center gap-1.5">
              <NotebookPen className="w-4 h-4 text-kin-dark" />
              参拝ひとことメモ
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={memoText}
                onChange={(e) => setMemoText(e.target.value)}
                placeholder="例：明石海峡の景色が最高でした！限定御朱印を拝受"
                className="flex-1 rounded-xl border border-washi-border bg-washi px-3 py-2 text-xs text-sumi focus:outline-none focus:border-kin"
              />
              <button
                type="button"
                onClick={() => handleSaveMemoAndMeta()}
                className="px-3.5 py-2 rounded-xl bg-sumi text-kin text-xs font-bold shrink-0 flex items-center gap-1 active:scale-95 transition"
              >
                {isSavingMemo ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> 保存済
                  </>
                ) : (
                  'メモ保存'
                )}
              </button>
            </div>
          </div>

          {/* 前の画面（マップ）に戻るボタン */}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl bg-sumi text-washi hover:bg-sumi-light font-serif font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition shadow"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-kin" />
            <span>前の画面（マップ）に戻る</span>
          </button>
        </div>
      </div>

      {/* ★画像タップで開くアップ拡大＆見開き回転ライトボックス */}
      <GoshuinPhotoLightbox
        record={
          isLightboxOpen && photoDataUrl
            ? {
                spotId: currentSpotTarget.id,
                name: spot.name,
                type: spot.type,
                denomination: spot.denomination,
                address: spot.address,
                lat: spot.lat,
                lng: spot.lng,
                visitedDate: visitedDateText,
                photoDataUrl,
                memo: memoText
              }
            : null
        }
        onClose={() => setIsLightboxOpen(false)}
        onUpdatedRecord={(updated) => {
          if (onSaved) onSaved(updated);
        }}
      />
    </div>
  );
}
