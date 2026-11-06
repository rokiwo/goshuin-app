import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Camera,
  MapPin,
  Sparkles,
  Compass,
  PlusCircle,
  Calendar,
  Palette,
  LayoutGrid,
  BookOpenText,
  Maximize2,
  X,
  Edit3,
  Heart,
  Trash2,
  RotateCw,
  ZoomIn,
  Layers,
  Award,
  Plus,
  Settings,
  ChevronRight,
  HardDrive,
  ArrowUpDown
} from 'lucide-react';
import GoshuinSampleGraphic from './GoshuinSampleGraphic.jsx';
import GoshuinShowcaseModal from './GoshuinShowcaseModal.jsx';
import GoshuinPhotoLightbox from './GoshuinPhotoLightbox.jsx';
import BookManageModal from './BookManageModal.jsx';
import BookAssignModal from './BookAssignModal.jsx';
import AlbumPlaceGroupView from './AlbumPlaceGroupView.jsx';
import AlbumCustomGroupView from './AlbumCustomGroupView.jsx';
import {
  sortVisitsByReceivedOrder,
  deleteVisitRecord,
  rotateBase64Image90,
  saveVisitRecord
} from '../db/database.js';

// 着せ替え可能な5種類の御朱印帳装丁テーマ（かわいい＆おしゃれな和モダン配色）
const COVER_THEMES = [
  {
    id: 'sakura',
    name: '桜金襴（さくら）',
    emoji: '🌸',
    coverBg: 'bg-gradient-to-br from-[#e88b9c] via-[#d96b82] to-[#b84a62]',
    patternColor: 'rgba(255, 245, 247, 0.22)',
    accentBorder: 'border-[#f7d6dc]',
    tagBg: 'bg-[#fff0f3] text-[#b84a62] border-[#f2bac6]',
    pageBg: 'bg-[#fff9fa]',
    badgeText: '華やか桜仕立て'
  },
  {
    id: 'matcha',
    name: '抹茶椿（まっちゃ）',
    emoji: '🍵',
    coverBg: 'bg-gradient-to-br from-[#3b6e52] via-[#2d5a40] to-[#1e402c]',
    patternColor: 'rgba(232, 215, 180, 0.18)',
    accentBorder: 'border-[#c5a059]',
    tagBg: 'bg-[#eef6f0] text-[#2d5a40] border-[#b7d6c2]',
    pageBg: 'bg-[#f9fbf9]',
    badgeText: 'レトロ京抹茶'
  },
  {
    id: 'ruri',
    name: '瑠璃星夜（るり）',
    emoji: '🌊',
    coverBg: 'bg-gradient-to-br from-[#274472] via-[#1d3557] to-[#0f1e36]',
    patternColor: 'rgba(197, 160, 89, 0.22)',
    accentBorder: 'border-[#e8d7b4]',
    tagBg: 'bg-[#eef3f9] text-[#1d3557] border-[#b6cae2]',
    pageBg: 'bg-[#f8fafd]',
    badgeText: '明石海峡・星夜'
  },
  {
    id: 'fuji',
    name: '藤紫（ふじむらさき）',
    emoji: '💜',
    coverBg: 'bg-gradient-to-br from-[#8e6baf] via-[#6f4e91] to-[#513570]',
    patternColor: 'rgba(252, 240, 255, 0.2)',
    accentBorder: 'border-[#e5d4f5]',
    tagBg: 'bg-[#f6f0fc] text-[#6f4e91] border-[#d8c2ee]',
    pageBg: 'bg-[#fcf9ff]',
    badgeText: '雅ラベンダー'
  },
  {
    id: 'sumi',
    name: '漆黒金彩（しっこく）',
    emoji: '✨',
    coverBg: 'bg-gradient-to-br from-[#2b2927] via-[#1a1a1a] to-[#0d0d0d]',
    patternColor: 'rgba(197, 160, 89, 0.22)',
    accentBorder: 'border-[#c5a059]',
    tagBg: 'bg-[#f7f2e4] text-[#8a6826] border-[#dec692]',
    pageBg: 'bg-[#fcfaf2]',
    badgeText: '伝統漆黒金襴'
  }
];

function getPilgrimRank(count) {
  if (count === 0) return { title: 'はじまりの参拝者', next: 1, icon: '🌱' };
  if (count < 3) return { title: '初穂の旅人', next: 3, icon: '🌸' };
  if (count < 7) return { title: '御朱印めぐり見習い', next: 7, icon: '⛩️' };
  if (count < 15) return { title: '福徳の巡拝者', next: 15, icon: '✨' };
  if (count < 30) return { title: '神社仏閣ソムリエ', next: 30, icon: '🕊️' };
  return { title: '天下無双の御朱印マイスター', next: 50, icon: '👑' };
}

export default function AlbumView({
  visitRecords = [],
  books = [],
  allSpots = [],
  onSelectSpotOnMap,
  onOpenSpotDetail,
  onOpenAddPastModal,
  onOpenBackupModal
}) {
  // 実物の御朱印帳選択（'all': 全体の御朱印帳, それ以外: bookId）
  const [selectedBookId, setSelectedBookId] = useState('all');
  const [isBookModalOpen, setIsBookModalOpen] = useState(false);
  const [editingBook, setEditingBook] = useState(null);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

  // 鑑賞スタイル（'timeline': 時系列, 'place': 社寺別まとめ, 'group': 巡拝グループ）
  const [displayStyle, setDisplayStyle] = useState('timeline');

  const [themeId, setThemeId] = useState(
    () => localStorage.getItem('goshuin_book_theme') || 'sakura'
  );
  const [bookTitle, setBookTitle] = useState(
    () => localStorage.getItem('goshuin_book_title') || 'わたしの御朱印帖'
  );
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem('goshuin_book_viewmode') || 'jabara'
  );

  // 御朱印の並び順（'asc': 古い順/拝受順, 'desc': 新しい順/最新参拝順）
  const [sortOrder, setSortOrder] = useState(
    () => localStorage.getItem('goshuin_sort_order') || 'asc'
  );

  const [tabFilter, setTabFilter] = useState('all');
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [lightboxRecord, setLightboxRecord] = useState(null);

  // 横長（見開き御朱印）かどうかを自動判定して保持するマップ { [spotId]: boolean }
  const [wideSpotMap, setWideSpotMap] = useState({});
  const [rotatingSpotId, setRotatingSpotId] = useState(null);

  // ★表紙タップで起動する特別鑑賞モード（'book3d' | 'skywall' | null）
  const [showcaseMode, setShowcaseMode] = useState(null);

  useEffect(() => {
    localStorage.setItem('goshuin_book_theme', themeId);
  }, [themeId]);

  useEffect(() => {
    localStorage.setItem('goshuin_book_viewmode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('goshuin_sort_order', sortOrder);
  }, [sortOrder]);

  // モーダルや拡大表示が開いているとき、Android戻るボタンでそれらを閉じる
  useEffect(() => {
    const isAnyModalOpen =
      Boolean(lightboxRecord) ||
      Boolean(showcaseMode) ||
      isBookModalOpen ||
      isAssignModalOpen;

    if (!isAnyModalOpen) return;

    try {
      window.history.pushState({ albumModalOpen: true }, '', window.location.href);
    } catch {}

    const handlePop = () => {
      if (lightboxRecord) setLightboxRecord(null);
      else if (showcaseMode) setShowcaseMode(null);
      else if (isAssignModalOpen) setIsAssignModalOpen(false);
      else if (isBookModalOpen) setIsBookModalOpen(false);
    };

    window.addEventListener('popstate', handlePop, { once: true });
    return () => {
      window.removeEventListener('popstate', handlePop);
    };
  }, [lightboxRecord, showcaseMode, isBookModalOpen, isAssignModalOpen]);

  const currentTheme =
    COVER_THEMES.find((t) => t.id === themeId) || COVER_THEMES[0];

  // 選択中の実物御朱印帳オブジェクト
  const activeBook =
    selectedBookId === 'all'
      ? null
      : books.find((b) => b.id === selectedBookId) || null;

  // 実物御朱印帳による絞り込み（'all' なら全件、特定 bookId ならその冊の御朱印のみ）
  const bookScopedRecords =
    selectedBookId === 'all'
      ? visitRecords
      : visitRecords.filter((r) => r.bookId === selectedBookId);

  // 御朱印の並び順（古い順 ⇔ 新しい順）にソート
  const visitedList = sortVisitsByReceivedOrder(bookScopedRecords, sortOrder);

  const totalVisited = visitedList.length;
  const totalPhotos = visitedList.filter((r) => Boolean(r.photoDataUrl)).length;
  const shrineCount = visitedList.filter((r) => r.type === 'shrine').length;
  const templeCount = visitedList.filter((r) => r.type === 'temple').length;

  const rankInfo = getPilgrimRank(totalVisited);
  const progressPercent = Math.min(100, Math.round((totalVisited / rankInfo.next) * 100));

  const filteredList = visitedList.filter((item) => {
    if (tabFilter === 'photo') return Boolean(item.photoDataUrl);
    if (tabFilter === 'shrine') return item.type === 'shrine';
    if (tabFilter === 'temple') return item.type === 'temple';
    return true;
  });

  const handleCardClick = (record) => {
    const matchedSpot = allSpots.find((s) => s.id === record.spotId) || {
      id: record.spotId,
      name: record.name,
      type: record.type,
      denomination: record.denomination,
      address: record.address,
      lat: record.lat,
      lng: record.lng,
      description: 'マイ御朱印帳に保存された参拝記録です。',
      sampleGoshuin: record.sampleGoshuin || []
    };
    onOpenSpotDetail(matchedSpot);
  };

  // 画像ロード時に横長（見開き御朱印）かどうかを自動判定
  const handleImageLoaded = (spotId, e) => {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      const isWide = img.naturalWidth > img.naturalHeight * 1.02;
      setWideSpotMap((prev) =>
        prev[spotId] === isWide ? prev : { ...prev, [spotId]: isWide }
      );
    }
  };

  // 縦向きで登録されてしまった見開き御朱印などをワンタップで90°回転して保存
  const handleQuickRotate90 = async (e, record) => {
    e.stopPropagation();
    if (!record?.photoDataUrl || rotatingSpotId) return;
    try {
      setRotatingSpotId(record.spotId);
      const rotated = await rotateBase64Image90(record.photoDataUrl, true);
      await saveVisitRecord(
        {
          id: record.spotId,
          name: record.name,
          type: record.type,
          denomination: record.denomination,
          address: record.address,
          lat: record.lat,
          lng: record.lng,
          sampleGoshuin: record.sampleGoshuin || []
        },
        {
          photoDataUrl: rotated
        }
      );
    } finally {
      setRotatingSpotId(null);
    }
  };

  const handleSaveBookTitle = (newTitle) => {
    const clean = newTitle.trim() || 'わたしの御朱印帖';
    setBookTitle(clean);
    localStorage.setItem('goshuin_book_title', clean);
    setIsEditingTitle(false);
  };

  // 登録済み御朱印の削除処理
  const handleDeleteRecord = async (e, record) => {
    e.stopPropagation();
    if (!record?.spotId) return;
    const ok = window.confirm(
      `「${record.name}」の御朱印記録を削除しますか？\n（※削除すると御朱印帳から取り除かれます）`
    );
    if (!ok) return;
    await deleteVisitRecord(record.spotId);
  };

  // 表紙タップ時のアクション（記録があればぶわーっと展開モーダルを開く）
  const handleCoverClick = () => {
    if (visitedList.length > 0) {
      setShowcaseMode('skywall');
    } else {
      onOpenAddPastModal();
    }
  };

  return (
    <div className={`w-full h-full overflow-y-auto ${currentTheme.pageBg} px-4 py-4 space-y-4 transition-colors duration-300`}>
      {/* ★実物の御朱印帳セレクター ＆ 新規登録ボタン */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar pb-0.5">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setSelectedBookId('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-serif font-bold transition flex items-center gap-1.5 ${
              selectedBookId === 'all'
                ? 'bg-shuiro text-washi shadow-md border border-kin'
                : 'bg-washi text-sumi-muted border border-washi-border hover:text-sumi'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>全体の御朱印帳</span>
            <span className="px-1.5 py-0.2 rounded-full bg-kin text-sumi text-[10px] font-sans font-black">
              {visitRecords.length}
            </span>
          </button>

          {books.map((b) => {
            const count = visitRecords.filter((r) => r.bookId === b.id).length;
            const isSelected = selectedBookId === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedBookId(b.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-serif font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                  isSelected
                    ? 'bg-shuiro text-washi shadow-md border border-kin'
                    : 'bg-washi text-sumi-muted border border-washi-border hover:text-sumi'
                }`}
              >
                <span>📖 {b.name}</span>
                <span className="px-1.5 py-0.2 rounded-full bg-kin text-sumi text-[10px] font-sans font-black">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingBook(null);
            setIsBookModalOpen(true);
          }}
          className="px-2.5 py-1.5 rounded-full bg-sumi text-kin border border-kin text-[11px] font-serif font-bold flex items-center gap-1 shrink-0 shadow-sm active:scale-95 transition"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>冊を登録</span>
        </button>
      </div>

      {/* ★実物の御朱印帳が選択されている場合の専用カバー表示 */}
      {selectedBookId !== 'all' && activeBook ? (
        <div className="relative rounded-3xl bg-gradient-to-br from-[#2c2826] via-[#1f1d1b] to-[#121110] text-washi p-5 border-2 border-kin shadow-2xl overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1.5">
              <span className="px-2.5 py-0.5 rounded-full bg-kin text-sumi font-serif font-black text-[10px]">
                実物の御朱印帳
              </span>
              <span className="text-xs text-washi/70 font-serif">
                収載 {totalVisited} 枚
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEditingBook(activeBook);
                  setIsBookModalOpen(true);
                }}
                className="px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 text-washi text-[11px] font-serif font-bold flex items-center gap-1 border border-white/20 active:scale-95 transition"
              >
                <Settings className="w-3 h-3 text-kin" />
                <span>表紙・情報を編集</span>
              </button>
              <button
                type="button"
                onClick={() => setIsAssignModalOpen(true)}
                className="px-2.5 py-1 rounded-full bg-kin/20 hover:bg-kin/30 text-kin-light text-[11px] font-serif font-bold flex items-center gap-1 border border-kin/40 active:scale-95 transition"
                title="登録済みの御朱印をこの冊にまとめて追加・解除"
              >
                <Layers className="w-3 h-3 text-kin" />
                <span>御朱印を振り分け</span>
              </button>
              <button
                type="button"
                onClick={onOpenAddPastModal}
                className="px-3 py-1 rounded-full bg-shuiro text-washi border border-kin text-xs font-serif font-bold flex items-center gap-1 shadow active:scale-95 transition"
              >
                <PlusCircle className="w-3 h-3" />
                <span>新規追加</span>
              </button>
            </div>
          </div>

          {/* 表紙・裏表紙の写真展示 */}
          <div className="grid grid-cols-2 gap-3 my-2">
            {/* 表紙 */}
            <div
              onClick={() => {
                if (activeBook.coverPhoto) {
                  setLightboxRecord({
                    spotId: activeBook.id,
                    name: `${activeBook.name}（表紙）`,
                    photoDataUrl: activeBook.coverPhoto,
                    visitedDate: activeBook.startedDate,
                    memo: activeBook.memo
                  });
                } else {
                  setEditingBook(activeBook);
                  setIsBookModalOpen(true);
                }
              }}
              className="w-full aspect-[3/4] rounded-2xl bg-black/40 border border-kin/50 overflow-hidden flex flex-col items-center justify-center p-1 cursor-pointer group shadow-inner relative"
            >
              {activeBook.coverPhoto ? (
                <>
                  <img
                    src={activeBook.coverPhoto}
                    alt="表紙"
                    className="w-full h-full object-contain rounded-xl"
                  />
                  <div className="absolute bottom-1.5 bg-sumi/80 px-2 py-0.5 rounded-full text-[9px] font-serif text-kin">
                    表紙（タップで拡大）
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-1 text-washi/50">
                  <Camera className="w-6 h-6" />
                  <span className="text-[10px] font-serif">表紙写真を未登録</span>
                </div>
              )}
            </div>

            {/* 裏表紙 */}
            <div
              onClick={() => {
                if (activeBook.backPhoto) {
                  setLightboxRecord({
                    spotId: `${activeBook.id}-back`,
                    name: `${activeBook.name}（裏表紙）`,
                    photoDataUrl: activeBook.backPhoto,
                    visitedDate: activeBook.startedDate,
                    memo: activeBook.memo
                  });
                } else {
                  setEditingBook(activeBook);
                  setIsBookModalOpen(true);
                }
              }}
              className="w-full aspect-[3/4] rounded-2xl bg-black/40 border border-kin/50 overflow-hidden flex flex-col items-center justify-center p-1 cursor-pointer group shadow-inner relative"
            >
              {activeBook.backPhoto ? (
                <>
                  <img
                    src={activeBook.backPhoto}
                    alt="裏表紙"
                    className="w-full h-full object-contain rounded-xl"
                  />
                  <div className="absolute bottom-1.5 bg-sumi/80 px-2 py-0.5 rounded-full text-[9px] font-serif text-kin">
                    裏表紙（タップで拡大）
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-1 text-washi/50">
                  <Camera className="w-6 h-6" />
                  <span className="text-[10px] font-serif">裏表紙写真を未登録</span>
                </div>
              )}
            </div>
          </div>

          {/* 冊情報 */}
          <div className="mt-2 pt-2 border-t border-white/15">
            <h2 className="font-serif font-black text-lg text-kin tracking-wider truncate">
              {activeBook.name}
            </h2>
            <div className="flex items-center justify-between text-[11px] text-washi/70 mt-1 flex-wrap gap-2">
              {activeBook.startedDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-shuiro" />
                  使い始め: {activeBook.startedDate}
                </span>
              )}
              {activeBook.memo && (
                <span className="italic">「{activeBook.memo}」</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ★本物の和装本・御朱印帳の表紙風デザインカード（全体の御朱印帳） */
        <div
          onClick={handleCoverClick}
          className={`relative rounded-3xl ${currentTheme.coverBg} text-washi p-5 border-2 ${currentTheme.accentBorder} shadow-2xl overflow-hidden transition-all duration-500 cursor-pointer active:scale-[0.99]`}
        >
          {/* 和柄の透かしSVG背景 */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none opacity-25"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <pattern id="wagara-circles" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="1" />
                <circle cx="20" cy="20" r="10" fill="none" stroke="currentColor" strokeWidth="0.8" />
                <circle cx="0" cy="40" r="16" fill="none" stroke="currentColor" strokeWidth="1" />
                <circle cx="40" cy="40" r="16" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#wagara-circles)" />
          </svg>

          {/* 上部アクションバー（装丁着せ替えボタン ＆ データ保存・移行 ＆ 過去御朱印追加ボタン） */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 flex items-center justify-between gap-1.5 mb-4 flex-wrap"
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setShowThemePicker(!showThemePicker)}
                className="px-2.5 py-1.5 rounded-full bg-white/20 backdrop-blur-md border border-white/40 text-white text-[11px] font-serif font-bold flex items-center gap-1 shadow-sm active:scale-95 transition"
              >
                <Palette className="w-3.5 h-3.5" />
                <span>着せ替え</span>
              </button>

              {onOpenBackupModal && (
                <button
                  type="button"
                  onClick={onOpenBackupModal}
                  className="px-2.5 py-1.5 rounded-full bg-kin/20 hover:bg-kin/30 backdrop-blur-md border border-kin/50 text-kin-light text-[11px] font-serif font-bold flex items-center gap-1 shadow-sm active:scale-95 transition"
                  title="これまでの御朱印データを丸ごと書き出し・復元"
                >
                  <HardDrive className="w-3.5 h-3.5 text-kin" />
                  <span>保存・移行</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onOpenAddPastModal}
              className="px-3 py-1.5 rounded-full bg-washi text-sumi border-2 border-kin text-xs font-serif font-bold flex items-center gap-1 shadow-lg active:scale-95 transition"
            >
              <PlusCircle className="w-3.5 h-3.5 text-shuiro" />
              <span>過去の御朱印を追加</span>
            </button>
          </div>

          {/* テーマ着せ替えパレット（開閉式） */}
          {showThemePicker && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 mb-4 p-3 rounded-2xl bg-sumi/85 backdrop-blur-md border border-white/25 space-y-2 animate-slide-up"
            >
              <p className="text-[11px] font-serif font-bold text-washi flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-kin" />
                御朱印帳の装丁デザインを選ぶ
              </p>
              <div className="grid grid-cols-5 gap-1.5">
                {COVER_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setThemeId(t.id);
                      setShowThemePicker(false);
                    }}
                    className={`p-2 rounded-xl border text-center transition flex flex-col items-center gap-1 ${
                      themeId === t.id
                        ? 'bg-washi text-sumi border-kin ring-2 ring-kin font-bold scale-105'
                        : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                    }`}
                  >
                    <span className="text-base">{t.emoji}</span>
                    <span className="text-[9px] leading-tight font-serif">
                      {t.name.split('（')[0]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 中央：御朱印帳の表題短冊（題箋）とスタッツ */}
          <div className="relative z-10 flex items-center gap-4">
            {/* 本物の御朱印帳の白い縦長題箋（表題シール） */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                setIsEditingTitle(true);
              }}
              title="タップして御朱印帳の名前を変更"
              className="shrink-0 bg-washi text-sumi px-3 py-3.5 rounded-xl border-2 border-kin shadow-xl flex flex-col items-center justify-between cursor-pointer hover:scale-[1.03] transition min-h-[132px]"
            >
              <span className="text-[8px] font-serif text-shuiro font-bold tracking-widest border-b border-shuiro/40 pb-0.5 mb-1">
                奉拝
              </span>
              <span className="font-serif font-black text-base text-sumi writing-vertical tracking-widest max-h-[86px] overflow-hidden">
                {bookTitle}
              </span>
              <Edit3 className="w-2.5 h-2.5 text-sumi-muted mt-1 opacity-60" />
            </div>

            {/* 右側：称号バッジ＆参拝カウンター */}
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="bg-black/25 backdrop-blur-sm rounded-2xl p-2.5 border border-white/20">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-serif font-bold text-white flex items-center gap-1">
                    <span>{rankInfo.icon}</span>
                    <span>{rankInfo.title}</span>
                  </span>
                  <span className="text-[10px] text-white/80 font-mono">
                    {totalVisited}/{rankInfo.next}社寺
                  </span>
                </div>
                <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-gradient-to-r from-kin-light via-kin to-shuiro rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="bg-white/15 backdrop-blur-sm rounded-xl p-2 border border-white/20">
                  <p className="text-[9px] text-white/80">参拝社寺</p>
                  <p className="font-serif font-black text-lg text-white leading-tight mt-0.5">
                    {totalVisited}
                    <span className="text-[9px] font-normal ml-0.5">ヶ所</span>
                  </p>
                </div>
                <div className="bg-white/15 backdrop-blur-sm rounded-xl p-2 border border-white/20">
                  <p className="text-[9px] text-white/80">御朱印写真</p>
                  <p className="font-serif font-black text-lg text-kin-light leading-tight mt-0.5">
                    {totalPhotos}
                    <span className="text-[9px] font-normal ml-0.5">枚</span>
                  </p>
                </div>
                <div className="bg-white/15 backdrop-blur-sm rounded-xl p-2 border border-white/20">
                  <p className="text-[9px] text-white/80">神社 / 寺</p>
                  <p className="font-serif font-bold text-xs text-white leading-tight mt-1.5">
                    {shrineCount} / {templeCount}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ★表紙下部：「3Dページめくり」＆「天空の御朱印ウォール」起動ボタンバー */}
          {totalVisited > 0 && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 mt-4 pt-3 border-t border-white/25 grid grid-cols-2 gap-2"
            >
              <button
                type="button"
                onClick={() => setShowcaseMode('book3d')}
                className="py-2 px-3 rounded-2xl bg-sumi/80 hover:bg-sumi text-kin border border-kin/60 font-serif font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>3D表紙で開いてめくる</span>
              </button>
              <button
                type="button"
                onClick={() => setShowcaseMode('skywall')}
                className="py-2 px-3 rounded-2xl bg-washi/95 hover:bg-washi text-shuiro border border-kin font-serif font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition"
              >
                <Sparkles className="w-3.5 h-3.5 text-kin-dark" />
                <span>天空ウォールで一斉展開</span>
              </button>
            </div>
          )}

          {/* 御朱印帳タイトル編集ミニフォーム */}
          {isEditingTitle && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 mt-3 pt-3 border-t border-white/25 flex items-center gap-2"
            >
              <input
                type="text"
                defaultValue={bookTitle}
                maxLength={10}
                placeholder="御朱印帳の名前（10文字以内）"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveBookTitle(e.currentTarget.value);
                }}
                id="book-title-input"
                className="flex-1 rounded-xl bg-washi text-sumi px-3 py-1.5 text-xs font-serif font-bold focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById('book-title-input');
                  handleSaveBookTitle(el ? el.value : bookTitle);
                }}
                className="px-3 py-1.5 rounded-xl bg-sumi text-kin text-xs font-serif font-bold border border-kin"
              >
                決定
              </button>
            </div>
          )}
        </div>
      )}

      {/* ★鑑賞スタイル切り替えバー（時系列・社寺別まとめ・巡拝グループ） */}
      <div className="p-1 rounded-2xl bg-washi border border-kin/40 shadow-sm flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => setDisplayStyle('timeline')}
          className={`flex-1 py-1.5 rounded-xl font-serif font-bold text-xs flex items-center justify-center gap-1 transition ${
            displayStyle === 'timeline'
              ? 'bg-shuiro text-washi shadow-sm'
              : 'text-sumi-muted hover:text-sumi'
          }`}
        >
          <BookOpenText className="w-3.5 h-3.5" />
          <span>時系列</span>
        </button>

        <button
          type="button"
          onClick={() => setDisplayStyle('place')}
          className={`flex-1 py-1.5 rounded-xl font-serif font-bold text-xs flex items-center justify-center gap-1 transition ${
            displayStyle === 'place'
              ? 'bg-shuiro text-washi shadow-sm'
              : 'text-sumi-muted hover:text-sumi'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>社寺別まとめ</span>
        </button>

        <button
          type="button"
          onClick={() => setDisplayStyle('group')}
          className={`flex-1 py-1.5 rounded-xl font-serif font-bold text-xs flex items-center justify-center gap-1 transition ${
            displayStyle === 'group'
              ? 'bg-shuiro text-washi shadow-sm'
              : 'text-sumi-muted hover:text-sumi'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          <span>巡拝グループ</span>
        </button>
      </div>

      {/* 絞り込みピル */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        {[
          { id: 'all', label: `すべて (${totalVisited})` },
          { id: 'photo', label: `写真 (${totalPhotos})` },
          { id: 'shrine', label: `⛩️神社 (${shrineCount})` },
          { id: 'temple', label: `☸️お寺 (${templeCount})` }
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTabFilter(tab.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-serif font-bold transition whitespace-nowrap shrink-0 ${
              tabFilter === tab.id
                ? 'bg-sumi text-kin border border-kin shadow-sm'
                : 'bg-washi text-sumi-muted border border-washi-border'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 時系列ビュー専用：表示スタイル切替 ＆ 並び順切替（古い順 ⇔ 新しい順） */}
      {displayStyle === 'timeline' && (
        <div className="flex items-center justify-between gap-2 pt-0.5">
          {/* 左：蛇腹帖 / 一覧 切替 */}
          <div className="flex items-center bg-washi border border-washi-border rounded-full p-0.5 shadow-sm shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('jabara')}
              title="蛇腹ブック表示"
              className={`px-2.5 py-1 rounded-full text-[11px] font-serif font-bold flex items-center gap-1 transition ${
                viewMode === 'jabara'
                  ? 'bg-shuiro text-washi shadow-sm'
                  : 'text-sumi-muted hover:text-sumi'
              }`}
            >
              <BookOpenText className="w-3.5 h-3.5" />
              <span>蛇腹帖</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              title="2列ギャラリー表示"
              className={`px-2.5 py-1 rounded-full text-[11px] font-serif font-bold flex items-center gap-1 transition ${
                viewMode === 'grid'
                  ? 'bg-shuiro text-washi shadow-sm'
                  : 'text-sumi-muted hover:text-sumi'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>一覧</span>
            </button>
          </div>

          {/* 右：古い順 / 新しい順 切替 */}
          <div className="flex items-center bg-washi border border-washi-border rounded-full p-0.5 shadow-sm shrink-0">
            <button
              type="button"
              onClick={() => setSortOrder('asc')}
              title="参拝日・拝受順（古い順）"
              className={`px-2.5 py-1 rounded-full text-[11px] font-serif font-bold flex items-center gap-1 transition ${
                sortOrder === 'asc'
                  ? 'bg-shuiro text-washi shadow-sm'
                  : 'text-sumi-muted hover:text-sumi'
              }`}
            >
              <ArrowUpDown className="w-3 h-3" />
              <span>古い順</span>
            </button>
            <button
              type="button"
              onClick={() => setSortOrder('desc')}
              title="参拝日・最新順（新しい順）"
              className={`px-2.5 py-1 rounded-full text-[11px] font-serif font-bold flex items-center gap-1 transition ${
                sortOrder === 'desc'
                  ? 'bg-shuiro text-washi shadow-sm'
                  : 'text-sumi-muted hover:text-sumi'
              }`}
            >
              <ArrowUpDown className="w-3 h-3" />
              <span>新しい順</span>
            </button>
          </div>
        </div>
      )}

      {/* 御朱印が空のときのウェルカム表示 */}
      {filteredList.length === 0 ? (
        <div className="jabara-card gold-corner-frame rounded-3xl p-8 text-center space-y-3 my-3">
          <div className="w-16 h-16 rounded-full bg-shuiro/10 text-shuiro mx-auto flex items-center justify-center border-2 border-shuiro/30 shadow-inner">
            <BookOpen className="w-7 h-7" />
          </div>
          <h3 className="font-serif font-black text-base text-sumi">
            あなただけの御朱印帳をはじめましょう
          </h3>
          <p className="text-xs text-sumi-muted leading-relaxed">
            すでにお持ちの御朱印写真を「過去の御朱印を追加」から登録するか、
            <br />
            マップから訪れた神社・お寺をタップして参拝印を押してみましょう！
          </p>
          <div className="flex flex-wrap justify-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={onOpenAddPastModal}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-shuiro text-washi font-serif font-bold text-xs shadow-md active:scale-95 transition"
            >
              <PlusCircle className="w-4 h-4" />
              手持ちの御朱印写真を登録する
            </button>
            <button
              type="button"
              onClick={onSelectSpotOnMap}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-sumi text-kin font-serif font-bold text-xs shadow-md active:scale-95 transition"
            >
              <Compass className="w-4 h-4" />
              マップで神社・お寺を探す
            </button>
          </div>
        </div>
      ) : displayStyle === 'place' ? (
        <AlbumPlaceGroupView
          records={filteredList}
          allSpots={allSpots}
          wideSpotMap={wideSpotMap}
          rotatingSpotId={rotatingSpotId}
          onCardClick={handleCardClick}
          onQuickRotate={handleQuickRotate90}
          onDeleteRecord={handleDeleteRecord}
          onOpenLightbox={(r) => setLightboxRecord(r)}
        />
      ) : displayStyle === 'group' ? (
        <AlbumCustomGroupView
          records={filteredList}
          allSpots={allSpots}
          wideSpotMap={wideSpotMap}
          rotatingSpotId={rotatingSpotId}
          onCardClick={handleCardClick}
          onQuickRotate={handleQuickRotate90}
          onDeleteRecord={handleDeleteRecord}
          onOpenLightbox={(r) => setLightboxRecord(r)}
        />
      ) : viewMode === 'jabara' ? (
        <div className="space-y-4 pb-8">
          {filteredList.map((record, idx) => {
            const isShrine = record.type === 'shrine';
            const pageNumber = record.pageNumber || idx + 1;
            const isLeftFold = idx % 2 === 0;
            const isWide = Boolean(wideSpotMap[record.spotId]);
            const firstSample = record.sampleGoshuin?.[0] || {
              calligraphy: record.name.slice(0, 4),
              subText: record.visitedDate || '奉拝',
              stampText: `${record.name.slice(0, 3)}印`
            };

            return (
              <div
                key={record.spotId}
                onClick={() => handleCardClick(record)}
                className={`${
                  isLeftFold ? 'jabara-fold-left' : 'jabara-fold-right'
                } gold-corner-frame rounded-3xl p-4 border-2 border-kin/45 cursor-pointer transition hover:shadow-xl active:scale-[0.99]`}
              >
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-kin/30 flex-wrap gap-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-full bg-sumi text-kin font-serif font-bold text-[10px]">
                      第 {pageNumber} 頁
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-serif font-bold ${currentTheme.tagBg} border`}
                    >
                      {isShrine ? '⛩️ 神社参拝' : '☸️ 寺院参拝'}
                    </span>
                    {isWide && record.photoDataUrl && (
                      <span className="px-2 py-0.5 rounded-full bg-kin text-sumi font-serif font-black text-[10px] shadow-sm">
                        📖 見開き御朱印
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {record.photoDataUrl && (
                      <button
                        type="button"
                        onClick={(e) => handleQuickRotate90(e, record)}
                        disabled={rotatingSpotId === record.spotId}
                        className="px-2 py-0.5 rounded-full bg-washi-dark hover:bg-kin/25 text-sumi border border-kin/50 text-[10px] font-serif font-bold flex items-center gap-1 transition active:scale-95"
                        title="見開き御朱印が縦になっている場合などに写真を90°回転します"
                      >
                        <RotateCw
                          className={`w-2.5 h-2.5 text-shuiro ${
                            rotatingSpotId === record.spotId ? 'animate-spin' : ''
                          }`}
                        />
                        <span>{isWide ? '向き回転' : '横向きにする'}</span>
                      </button>
                    )}
                    <span className="text-[11px] font-serif font-bold text-sumi-muted flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-shuiro" />
                      {record.visitedDate || '記録済'}
                    </span>
                  </div>
                </div>

                {/* ★見開き（横長）御朱印の場合は、左右が切れないように横幅いっぱいの見開き専用フレームで全体像を表示 */}
                {isWide && record.photoDataUrl ? (
                  <div className="space-y-3">
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxRecord(record);
                      }}
                      className="relative w-full rounded-2xl overflow-hidden bg-washi-dark border-2 border-kin shadow-md flex items-center justify-center p-1.5 group cursor-zoom-in"
                      title="タップして見開き御朱印をアップで拡大表示"
                    >
                      <img
                        src={record.photoDataUrl}
                        alt={record.name}
                        onLoad={(e) => handleImageLoaded(record.spotId, e)}
                        className="w-full max-h-64 object-contain rounded-xl group-hover:scale-[1.02] transition duration-300"
                      />

                      <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-washi/95 border border-shuiro text-shuiro font-serif font-black text-[10px] rotate-[-6deg] shadow-sm">
                        奉拝・見開き
                      </div>

                      <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-full bg-sumi/85 text-kin border border-kin/50 text-[10px] font-serif font-bold flex items-center gap-1 shadow">
                        <ZoomIn className="w-3 h-3" />
                        <span>タップでアップ表示</span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-serif font-black text-lg text-sumi leading-snug">
                            {record.name}
                          </h3>
                          {record.address && (
                            <p className="text-[11px] text-sumi-muted flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3 text-shuiro shrink-0" />
                              <span>{record.address}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      {record.memo && (
                        <div className="p-2.5 rounded-xl bg-washi/90 border border-kin/35 text-xs text-sumi font-serif leading-relaxed shadow-inner">
                          「{record.memo}」
                        </div>
                      )}

                      {record.aiPhotoAnalysis?.calligraphyReading && (
                        <div className="p-2 rounded-xl bg-shuiro/5 border border-shuiro/25 text-[11px] text-sumi">
                          <span className="font-serif font-bold text-shuiro block">
                            ✦ AI墨書解読:
                          </span>
                          <span className="line-clamp-2 text-sumi-muted">
                            {record.aiPhotoAnalysis.calligraphyReading}
                          </span>
                        </div>
                      )}

                      <div className="pt-1.5 flex items-center justify-between text-[11px] font-serif font-bold text-shuiro">
                        <button
                          type="button"
                          onClick={(e) => handleDeleteRecord(e, record)}
                          className="px-2.5 py-1 rounded-lg bg-shuiro/10 hover:bg-shuiro/20 text-shuiro border border-shuiro/30 flex items-center gap-1 transition active:scale-95"
                          title="この御朱印記録を削除"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>削除</span>
                        </button>
                        <span>詳細・編集 →</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* 通常（縦型）御朱印のレイアウト：画像タップで即アップ表示 */
                  <div className="flex gap-4 items-stretch">
                    <div
                      onClick={(e) => {
                        if (record.photoDataUrl) {
                          e.stopPropagation();
                          setLightboxRecord(record);
                        }
                      }}
                      className={`relative w-36 sm:w-40 aspect-[3/4] rounded-2xl overflow-hidden bg-washi-dark border-2 border-kin/50 shadow-md shrink-0 flex items-center justify-center group ${
                        record.photoDataUrl ? 'cursor-zoom-in' : ''
                      }`}
                      title={
                        record.photoDataUrl
                          ? 'タップして御朱印をアップで拡大表示'
                          : undefined
                      }
                    >
                      {record.photoDataUrl ? (
                        <>
                          <img
                            src={record.photoDataUrl}
                            alt={record.name}
                            onLoad={(e) => handleImageLoaded(record.spotId, e)}
                            className="w-full h-full object-contain bg-washi-dark group-hover:scale-105 transition duration-300"
                          />
                          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-sumi/85 text-kin border border-kin/50 flex items-center gap-1 text-[9px] font-serif font-bold shadow">
                            <ZoomIn className="w-3 h-3" />
                            <span>拡大</span>
                          </div>
                        </>
                      ) : (
                        <div className="scale-95">
                          <GoshuinSampleGraphic
                            sample={firstSample}
                            spotType={record.type}
                            compact
                          />
                        </div>
                      )}

                      <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-washi/95 border border-shuiro text-shuiro font-serif font-black text-[10px] rotate-[-8deg] shadow-sm">
                        奉拝済
                      </div>
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                      <div className="space-y-1.5">
                        <h3 className="font-serif font-black text-lg text-sumi leading-snug">
                          {record.name}
                        </h3>

                        {record.address && (
                          <p className="text-[11px] text-sumi-muted flex items-center gap-1 truncate">
                            <MapPin className="w-3 h-3 text-shuiro shrink-0" />
                            <span className="truncate">{record.address}</span>
                          </p>
                        )}

                        {record.memo ? (
                          <div className="mt-2 p-2.5 rounded-xl bg-washi/90 border border-kin/35 text-xs text-sumi font-serif leading-relaxed shadow-inner">
                            「{record.memo}」
                          </div>
                        ) : (
                          <p className="text-[11px] text-sumi-muted italic pt-1">
                            画像をタップするとアップで拡大表示できます
                          </p>
                        )}

                        {record.aiPhotoAnalysis?.calligraphyReading && (
                          <div className="p-2 rounded-xl bg-shuiro/5 border border-shuiro/25 text-[11px] text-sumi">
                            <span className="font-serif font-bold text-shuiro block">
                              ✦ AI墨書解読:
                            </span>
                            <span className="line-clamp-2 text-sumi-muted">
                              {record.aiPhotoAnalysis.calligraphyReading}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="pt-2 flex items-center justify-between text-[11px] font-serif font-bold text-shuiro">
                        <button
                          type="button"
                          onClick={(e) => handleDeleteRecord(e, record)}
                          className="px-2 py-1 rounded-lg bg-shuiro/10 hover:bg-shuiro/20 text-shuiro border border-shuiro/30 flex items-center gap-1 transition active:scale-95"
                          title="この御朱印記録を削除"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>削除</span>
                        </button>
                        <span>詳細・編集 →</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3.5 pb-8">
          {filteredList.map((record, idx) => {
            const isShrine = record.type === 'shrine';
            const isWide = Boolean(wideSpotMap[record.spotId]);
            const firstSample = record.sampleGoshuin?.[0] || {
              calligraphy: record.name.slice(0, 4),
              subText: record.visitedDate || '奉拝',
              stampText: `${record.name.slice(0, 3)}印`
            };

            return (
              <div
                key={record.spotId}
                onClick={() => handleCardClick(record)}
                className={`jabara-card gold-corner-frame rounded-2xl p-3 flex flex-col justify-between cursor-pointer active:scale-[0.98] transition hover:shadow-xl ${
                  isWide && record.photoDataUrl ? 'col-span-2' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-serif text-kin-dark font-bold">
                      第{record.pageNumber || idx + 1}頁
                    </span>
                    {isWide && record.photoDataUrl && (
                      <span className="px-2 py-0.5 rounded-full bg-kin text-sumi font-serif font-black text-[9px]">
                        📖 見開き
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {record.photoDataUrl && (
                      <button
                        type="button"
                        onClick={(e) => handleQuickRotate90(e, record)}
                        className="p-1 rounded-full bg-washi-dark hover:bg-kin/20 text-sumi border border-kin/40"
                        title="写真を90°回転（横向きにする）"
                      >
                        <RotateCw className="w-2.5 h-2.5 text-shuiro" />
                      </button>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[9px] font-bold text-washi ${
                        isShrine ? 'bg-shuiro' : 'bg-tera'
                      }`}
                    >
                      {isShrine ? '⛩️ 神社' : '☸️ 寺院'}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteRecord(e, record)}
                      className="p-1 rounded-full bg-shuiro/10 hover:bg-shuiro/20 text-shuiro border border-shuiro/30"
                      title="この御朱印記録を削除"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>

                <div
                  onClick={(e) => {
                    if (record.photoDataUrl) {
                      e.stopPropagation();
                      setLightboxRecord(record);
                    }
                  }}
                  className={`relative w-full ${
                    isWide && record.photoDataUrl
                      ? 'max-h-56 py-1'
                      : 'aspect-[3/4]'
                  } rounded-xl overflow-hidden bg-washi-dark border border-kin/40 flex items-center justify-center mb-2.5 shadow-sm ${
                    record.photoDataUrl ? 'cursor-zoom-in' : ''
                  }`}
                >
                  {record.photoDataUrl ? (
                    <>
                      <img
                        src={record.photoDataUrl}
                        alt={record.name}
                        onLoad={(e) => handleImageLoaded(record.spotId, e)}
                        className={`w-full ${
                          isWide ? 'max-h-52 object-contain' : 'h-full object-contain'
                        }`}
                      />
                      <div className="absolute bottom-1.5 right-1.5 bg-sumi/85 text-kin px-2 py-0.5 rounded-full shadow flex items-center gap-1 text-[9px] font-serif font-bold">
                        <ZoomIn className="w-3 h-3" />
                        <span>拡大</span>
                      </div>
                    </>
                  ) : (
                    <div className="scale-95">
                      <GoshuinSampleGraphic
                        sample={firstSample}
                        spotType={record.type}
                        compact
                      />
                    </div>
                  )}

                  <div className="absolute top-1.5 left-1.5 w-7 h-7 rounded bg-washi/95 border border-shuiro flex items-center justify-center text-shuiro font-serif font-black text-[10px] rotate-[-8deg] shadow-sm">
                    奉拝
                  </div>
                </div>

                <div>
                  <h3 className="font-serif font-bold text-sm text-sumi truncate">
                    {record.name}
                  </h3>
                  <p className="text-[10px] text-sumi-muted mt-0.5 flex items-center gap-1">
                    <Calendar className="w-2.5 h-2.5 text-shuiro shrink-0" />
                    <span>{record.visitedDate || '記録済'}</span>
                  </p>
                  {record.memo && (
                    <p className="mt-1.5 text-[10px] text-sumi bg-washi-dark/90 px-2 py-1 rounded border border-washi-border line-clamp-1 font-serif">
                      「{record.memo}」
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ★表紙タップで開く『3Dページめくり ＆ 天空の御朱印ウォール』モーダル */}
      <GoshuinShowcaseModal
        isOpen={Boolean(showcaseMode)}
        initialMode={showcaseMode || 'book3d'}
        onClose={() => setShowcaseMode(null)}
        visitedList={visitedList}
        currentTheme={currentTheme}
        bookTitle={bookTitle}
        onSelectRecordDetail={handleCardClick}
      />

      {/* ★御朱印画像タップで開く「ズーム＆見開き横回転対応 アップ表示ライトボックス」 */}
      <GoshuinPhotoLightbox
        record={lightboxRecord}
        onClose={() => setLightboxRecord(null)}
        onUpdatedRecord={(updated) => {
          setLightboxRecord((prev) =>
            prev ? { ...prev, photoDataUrl: updated.photoDataUrl } : null
          );
        }}
      />

      {/* ★実物の御朱印帳（冊）の作成・編集モーダル */}
      <BookManageModal
        isOpen={isBookModalOpen}
        onClose={() => {
          setIsBookModalOpen(false);
          setEditingBook(null);
        }}
        book={editingBook}
        onSaved={(saved) => {
          setSelectedBookId(saved.id);
        }}
        onDeleted={(deletedId) => {
          if (selectedBookId === deletedId) setSelectedBookId('all');
        }}
      />

      {/* ★登録済み御朱印を実物御朱印帳（冊）にまとめて振り分けるモーダル */}
      <BookAssignModal
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        activeBook={activeBook}
        allVisits={visitRecords}
      />
    </div>
  );
}
