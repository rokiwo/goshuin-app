import React, { useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Compass, BookOpen, MapPin, Sparkles, KeyRound, PlusCircle, Heart, HardDrive } from 'lucide-react';
import { db, getPlaceId, extractPrefectureFromSpot } from './db/database.js';
import { DEFAULT_CENTER, SEED_SPOTS } from './data/seedSpots.js';
import { fetchNearbyWorshipSpots, calculateDistanceKm } from './services/overpassApi.js';
import { getGeminiApiKey } from './services/geminiService.js';
import {
  getSavedCouplePasscode,
  syncCoupleGoshuinData
} from './services/coupleSyncService.js';
import MapView from './components/MapView.jsx';
import SpotBottomSheet from './components/SpotBottomSheet.jsx';
import AlbumView from './components/AlbumView.jsx';
import AiConciergeView from './components/AiConciergeView.jsx';
import AiSettingsModal from './components/AiSettingsModal.jsx';
import PastGoshuinModal from './components/PastGoshuinModal.jsx';
import CoupleSyncModal from './components/CoupleSyncModal.jsx';
import DataBackupModal from './components/DataBackupModal.jsx';
import GoogleMapsImportModal from './components/GoogleMapsImportModal.jsx';
import ExitConfirmModal from './components/ExitConfirmModal.jsx';
import {
  BackHandlerProvider,
  useBackHandler,
  useBackHandlerContext
} from './contexts/BackHandlerContext.jsx';
import { isIOSDevice } from './utils/platform.js';

function AppContent({ activeTab, setActiveTab }) {
  const isIOS = React.useMemo(() => isIOSDevice(), []);

  // モーダル開閉ステート
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isAddPastModalOpen, setIsAddPastModalOpen] = useState(false);
  const [isCoupleModalOpen, setIsCoupleModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isGmapImportModalOpen, setIsGmapImportModalOpen] = useState(false);
  const [gmapImportPayload, setGmapImportPayload] = useState(null);

  const [hasApiKey, setHasApiKey] = useState(() => Boolean(getGeminiApiKey()));
  const [isCoupleConnected, setIsCoupleConnected] = useState(() =>
    Boolean(getSavedCouplePasscode())
  );

  // 現在地座標（初期値は兵庫県明石市周辺フォールバック）
  const [userLocation, setUserLocation] = useState({
    lat: DEFAULT_CENTER.lat,
    lng: DEFAULT_CENTER.lng,
    isFallback: true
  });

  // 現在の検索中心座標
  const [searchCenter, setSearchCenter] = useState({
    lat: DEFAULT_CENTER.lat,
    lng: DEFAULT_CENTER.lng
  });

  // 地図移動ターゲット
  const [flyTarget, setFlyTarget] = useState({
    lat: DEFAULT_CENTER.lat,
    lng: DEFAULT_CENTER.lng,
    zoom: 12
  });

  // スポット一覧
  const [spots, setSpots] = useState(() =>
    SEED_SPOTS.map((s) => ({
      ...s,
      distanceKm: calculateDistanceKm(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng, s.lat, s.lng)
    })).sort((a, b) => a.distanceKm - b.distanceKm)
  );

  const [filterType, setFilterType] = useState('all');
  const [selectedFavPrefecture, setSelectedFavPrefecture] = useState('ALL');
  const [favFitTrigger, setFavFitTrigger] = useState(0);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [isLoadingOverpass, setIsLoadingOverpass] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    `主要御朱印社寺 ${SEED_SPOTS.length}件＋周辺検索中`
  );

  // ★戻るボタン連動ハンドラー登録（寺社詳細・各モーダル）
  // 寺社を選択した状態で閉じるを押さずに戻るを押した場合、寺社詳細が閉じてマップ画面に戻る（アプリは落ちない）
  useBackHandler({
    id: 'spot-detail-sheet',
    isOpen: Boolean(selectedSpot),
    onBack: () => setSelectedSpot(null),
    priority: 10
  });

  useBackHandler({
    id: 'backup-modal',
    isOpen: isBackupModalOpen,
    onBack: () => setIsBackupModalOpen(false),
    priority: 10
  });

  useBackHandler({
    id: 'add-past-modal',
    isOpen: isAddPastModalOpen,
    onBack: () => setIsAddPastModalOpen(false),
    priority: 10
  });

  useBackHandler({
    id: 'couple-modal',
    isOpen: isCoupleModalOpen,
    onBack: () => setIsCoupleModalOpen(false),
    priority: 10
  });

  useBackHandler({
    id: 'ai-settings-modal',
    isOpen: isAiModalOpen,
    onBack: () => setIsAiModalOpen(false),
    priority: 10
  });

  useBackHandler({
    id: 'gmap-import-modal',
    isOpen: isGmapImportModalOpen,
    onBack: () => setIsGmapImportModalOpen(false),
    priority: 10
  });

  // アプリ終了確認アナウンスの開閉ステート
  const { isExitConfirmOpen, setIsExitConfirmOpen } = useBackHandlerContext();

  // 検索半径（km）：5 / 10 / 15 / 20 から選択（前回の選択を記憶）
  const [searchRadiusKm, setSearchRadiusKm] = useState(() => {
    const saved = Number(localStorage.getItem('goshuin_search_radius_km'));
    return [5, 10, 15, 20].includes(saved) ? saved : 10;
  });

  // Dexie.js (IndexedDB) から参拝記録・実物御朱印帳・お気に入りをリアルタイム購読
  const visitRecords = useLiveQuery(() => db.visits.toArray(), [], []);
  const goshuinBooks = useLiveQuery(() => db.books.toArray(), [], []);
  const favoriteRecords = useLiveQuery(() => db.favorites.toArray(), [], []);

  // お気に入り社寺ID（spotId）をキーにした参照マップ
  const favoriteMap = React.useMemo(() => {
    const map = {};
    for (const fav of favoriteRecords || []) {
      map[fav.spotId] = fav;
    }
    return map;
  }, [favoriteRecords]);

  // レコードID（spotId）をキーにした参照マップ（同じ社寺の2枚目以降も個別に参照）
  const entryMap = React.useMemo(() => {
    const map = {};
    for (const rec of visitRecords || []) map[rec.spotId] = rec;
    return map;
  }, [visitRecords]);

  // 社寺ID（placeId）をキーにした参照マップ（地図ピンの参拝済み表示用・1枚目を優先）
  const visitMap = React.useMemo(() => {
    const map = {};
    for (const rec of visitRecords || []) {
      const pid = getPlaceId(rec);
      const cur = map[pid];
      if (!cur || rec.spotId === pid || (!cur.visited && rec.visited)) {
        map[pid] = rec;
      }
    }
    return map;
  }, [visitRecords]);

  // 過去の御朱印・お気に入り登録済み社寺・夫婦共有で追加されたカスタム寺社もマップのピン一覧に統合する
  const mergedSpots = React.useMemo(() => {
    const existingIds = new Set(spots.map((s) => s.id));
    const customVisitedSpots = [];
    for (const rec of visitRecords || []) {
      const pid = getPlaceId(rec);
      if (rec.visited && !existingIds.has(pid) && typeof rec.lat === 'number' && typeof rec.lng === 'number') {
        existingIds.add(pid);
        customVisitedSpots.push({
          id: pid,
          name: rec.name,
          type: rec.type || 'shrine',
          denomination: rec.denomination || '参拝記録',
          address: rec.address || '',
          lat: rec.lat,
          lng: rec.lng,
          distanceKm: calculateDistanceKm(userLocation.lat, userLocation.lng, rec.lat, rec.lng),
          description: 'マイ御朱印帳に登録された参拝スポットです。',
          sampleGoshuin: rec.sampleGoshuin || [],
          hasGoshuin: true
        });
      }
    }

    const customFavoriteSpots = [];
    for (const fav of favoriteRecords || []) {
      if (!existingIds.has(fav.spotId) && typeof fav.lat === 'number' && typeof fav.lng === 'number') {
        existingIds.add(fav.spotId);
        customFavoriteSpots.push({
          id: fav.spotId,
          name: fav.name,
          type: fav.type || 'shrine',
          denomination: fav.denomination || (fav.type === 'temple' ? '仏教（寺院）' : '神道（神社）'),
          address: fav.address || fav.prefecture || '',
          prefecture: fav.prefecture || '',
          lat: fav.lat,
          lng: fav.lng,
          distanceKm: calculateDistanceKm(userLocation.lat, userLocation.lng, fav.lat, fav.lng),
          description: `${fav.prefecture || ''}のお気に入りに登録された参拝スポットです。`,
          sampleGoshuin: fav.sampleGoshuin || [],
          hasGoshuin: true
        });
      }
    }

    return [...spots, ...customVisitedSpots, ...customFavoriteSpots];
  }, [spots, visitRecords, favoriteRecords, userLocation.lat, userLocation.lng]);

  const visitedCount = React.useMemo(
    () => (visitRecords || []).filter((r) => r.visited).length,
    [visitRecords]
  );

  // 起動時および画面復帰時に最新ServiceWorkerの即時適用＆夫婦クラウド同期を自動実行
  useEffect(() => {
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((reg) => {
            reg.update();
            if (reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });
      }
    } catch {
      // ignore
    }

    if (getSavedCouplePasscode()) {
      syncCoupleGoshuinData()
        .then((res) => {
          if (res.hasApiKeyNow) setHasApiKey(true);
        })
        .catch(() => {});
    }

    // Android等の「Googleマップ → 共有 → 御朱印めぐり（Web Share Target）」から起動された場合の自動取り込み
    try {
      const params = new URLSearchParams(window.location.search);
      const sharedTitle = (params.get('title') || '').trim();
      const sharedText = (params.get('text') || '').trim();
      const sharedUrl = (params.get('url') || '').trim();
      if (sharedTitle || sharedText || sharedUrl) {
        window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        setGmapImportPayload({
          title: sharedTitle,
          text: sharedText,
          url: sharedUrl
        });
        setIsGmapImportModalOpen(true);
      }
    } catch {
      // ignore
    }
  }, []);

  // 指定座標から「指定半径」の神社・寺院をWikipedia Geosearch＋Overpass APIで並列検索
  const loadNearbySpots = useCallback(async (lat, lng, radiusKmArg) => {
    const radiusKm =
      radiusKmArg || Number(localStorage.getItem('goshuin_search_radius_km')) || 10;
    setIsLoadingOverpass(true);
    setSearchCenter({ lat, lng });
    try {
      const result = await fetchNearbyWorshipSpots(lat, lng, radiusKm * 1000);
      setSpots(result.spots);
      setStatusMessage(`半径${radiusKm}km以内の御朱印社寺 ${result.spots.length}件を表示中`);
    } catch {
      setStatusMessage(`主要御朱印社寺 ${SEED_SPOTS.length}件を表示中`);
    } finally {
      setIsLoadingOverpass(false);
    }
  }, []);

  // 検索半径の変更 → 現在の検索中心で即再検索
  const handleChangeRadius = (km) => {
    setSearchRadiusKm(km);
    localStorage.setItem('goshuin_search_radius_km', String(km));
    loadNearbySpots(searchCenter.lat, searchCenter.lng, km);
  };

  // 初回マウント時にGPS現在地を取得し、失敗時は明石市（34.6494, 134.9961）で検索実行
  useEffect(() => {
    if (!navigator.geolocation) {
      loadNearbySpots(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserLocation({ lat, lng, isFallback: false });
        setFlyTarget({ lat, lng, zoom: 12 });
        loadNearbySpots(lat, lng);
      },
      () => {
        setUserLocation({
          lat: DEFAULT_CENTER.lat,
          lng: DEFAULT_CENTER.lng,
          isFallback: true
        });
        loadNearbySpots(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
      },
      {
        enableHighAccuracy: true,
        timeout: 6000,
        maximumAge: 60000
      }
    );
  }, [loadNearbySpots]);

  // スポット選択時に地図をスムーズに移動してボトムシートを表示
  const handleSelectSpot = (spot) => {
    setActiveTab('map');
    setSelectedSpot(spot);
    setFlyTarget({
      lat: spot.lat,
      lng: spot.lng,
      zoom: 15
    });
  };

  // Googleマップ共有/URL取り込み完了時：フィルタで隠れないようにしてから地図へ移動
  const handleImportedGmapSpot = (spot) => {
    const pref = spot.prefecture || extractPrefectureFromSpot(spot);
    if (filterType === 'favorite') {
      setSelectedFavPrefecture(pref || 'ALL');
    } else if (filterType !== 'all') {
      setFilterType('all');
    }
    handleSelectSpot(spot);
  };

  // AIコース等から「指定県のお気に入りのみマップ表示」へジャンプ
  const handleShowPrefectureFavoritesOnMap = (prefecture) => {
    setSelectedSpot(null);
    setFlyTarget(null);
    setSelectedFavPrefecture(prefecture || 'ALL');
    setFilterType('favorite');
    setFavFitTrigger((n) => n + 1);
    setActiveTab('map');
  };

  // 現在地へ戻るボタン
  const handleRecenterUser = () => {
    setFlyTarget({
      lat: userLocation.lat,
      lng: userLocation.lng,
      zoom: 13
    });
    loadNearbySpots(userLocation.lat, userLocation.lng);
  };

  // 共通アクションボタン群（Androidは上部バナーに配置、iPhoneは上部誤タップ・触れなくなる問題防止のため下部ドックに配置）
  const actionButtonsRow = (
    <div className="grid grid-cols-4 gap-1.5">
      {/* 過去の御朱印追加ボタン */}
      <button
        type="button"
        onClick={() => setIsAddPastModalOpen(true)}
        className="py-1.5 px-2 rounded-xl bg-shuiro border border-kin/60 text-washi text-[11px] font-serif font-bold flex items-center justify-center gap-1 active:scale-95 transition shadow whitespace-nowrap"
        title="過去の御朱印を写真・日付・場所で登録"
      >
        <PlusCircle className="w-3 h-3 text-kin shrink-0" />
        <span>追加</span>
      </button>

      {/* データ移行・バックアップボタン */}
      <button
        type="button"
        onClick={() => setIsBackupModalOpen(true)}
        className="py-1.5 px-2 rounded-xl border border-kin/45 bg-sumi-light text-kin text-[11px] font-serif font-bold flex items-center justify-center gap-1 active:scale-95 transition shadow whitespace-nowrap"
        title="データ移行・バックアップの書き出し＆復元"
      >
        <HardDrive className="w-3 h-3 text-kin shrink-0" />
        <span>移行</span>
      </button>

      {/* 夫婦共有ボタン */}
      <button
        type="button"
        onClick={() => setIsCoupleModalOpen(true)}
        className={`py-1.5 px-2 rounded-xl border text-[11px] font-serif font-bold flex items-center justify-center gap-1 active:scale-95 transition whitespace-nowrap ${
          isCoupleConnected
            ? 'bg-[#b84a62] border-pink-200 text-white shadow'
            : 'bg-sumi-light border-pink-300/40 text-pink-200'
        }`}
        title="夫婦の合言葉で共有・同期"
      >
        <Heart className={`w-3 h-3 shrink-0 ${isCoupleConnected ? 'fill-pink-200 text-pink-200' : ''}`} />
        <span>{isCoupleConnected ? '共有中' : '夫婦共有'}</span>
      </button>

      {/* AI設定ボタン */}
      <button
        type="button"
        onClick={() => setIsAiModalOpen(true)}
        className={`py-1.5 px-2 rounded-xl border text-[11px] font-serif font-bold flex items-center justify-center gap-1 active:scale-95 transition whitespace-nowrap ${
          hasApiKey
            ? 'bg-kin/15 border-kin text-kin'
            : 'bg-sumi-light border-washi/30 text-washi/80'
        }`}
        title="Gemini AI設定"
      >
        <KeyRound className="w-3 h-3 shrink-0" />
        <span>{hasApiKey ? 'AI済' : 'AI設定'}</span>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen w-full bg-sumi flex justify-center">
      <div className="w-full max-w-[430px] h-[100dvh] bg-washi flex flex-col shadow-2xl relative overflow-hidden border-x border-kin/20">
        {/* 和モダン上部ヘッダー（Androidは上端ギリギリ＋4ボタン上配置 / iPhoneはタイトルのみで上部干渉を回避） */}
        <header className="bg-sumi text-washi px-3 pb-1.5 safe-top-header border-b border-kin/40 flex flex-col gap-1 shrink-0 z-30">
          {/* 上段：アプリアイコン＋横1行タイトル＋周辺社寺ステータス */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-shuiro border border-kin flex items-center justify-center shadow-inner shrink-0">
                <span className="font-serif font-black text-xs text-washi">朱</span>
              </div>
              <h1 className="font-serif font-bold text-sm tracking-wider text-washi whitespace-nowrap shrink-0">
                御朱印めぐり
              </h1>
            </div>
            <p className="text-[10px] text-washi/75 flex items-center gap-1 truncate min-w-0">
              <MapPin className="w-3 h-3 text-shuiro shrink-0" />
              <span className="truncate">{statusMessage}</span>
            </p>
          </div>

          {/* Android・PC用：上部バナー内に4ボタンを配置 */}
          {!isIOS && actionButtonsRow}
        </header>

        {/* メインコンテンツ領域 */}
        <main className="flex-1 relative overflow-hidden">
          {activeTab === 'map' && (
            <MapView
              userLocation={userLocation}
              searchCenter={searchCenter}
              spots={mergedSpots}
              visitMap={visitMap}
              favoriteMap={favoriteMap}
              selectedSpot={selectedSpot}
              onSelectSpot={handleSelectSpot}
              onFlyToSpot={handleSelectSpot}
              filterType={filterType}
              onFilterChange={setFilterType}
              selectedFavPrefecture={selectedFavPrefecture}
              onChangeFavPrefecture={setSelectedFavPrefecture}
              favFitTrigger={favFitTrigger}
              isLoading={isLoadingOverpass}
              onRefreshNearby={() => loadNearbySpots(searchCenter.lat, searchCenter.lng)}
              onSearchMapCenter={(lat, lng) => loadNearbySpots(lat, lng)}
              flyTarget={flyTarget}
              onRecenterUser={handleRecenterUser}
              searchRadiusKm={searchRadiusKm}
              onChangeRadius={handleChangeRadius}
              onOpenGmapImport={(initialText) => {
                setGmapImportPayload(initialText ? { rawText: initialText } : null);
                setIsGmapImportModalOpen(true);
              }}
            />
          )}

          {activeTab === 'concierge' && (
            <AiConciergeView
              userLocation={userLocation}
              spots={mergedSpots}
              favorites={favoriteRecords || []}
              visitMap={visitMap}
              onSelectSpotOnMap={handleSelectSpot}
              onShowPrefectureFavoritesOnMap={handleShowPrefectureFavoritesOnMap}
              onOpenGmapImport={() => {
                setGmapImportPayload(null);
                setIsGmapImportModalOpen(true);
              }}
              onOpenAiSettings={() => setIsAiModalOpen(true)}
            />
          )}

          {activeTab === 'album' && (
            <AlbumView
              visitRecords={visitRecords || []}
              books={goshuinBooks || []}
              allSpots={mergedSpots}
              onSelectSpotOnMap={() => setActiveTab('map')}
              onOpenSpotDetail={(spot) => setSelectedSpot(spot)}
              onOpenAddPastModal={() => setIsAddPastModalOpen(true)}
              onOpenBackupModal={() => setIsBackupModalOpen(true)}
            />
          )}
        </main>

        {/* 下部タブバー（iPhoneでは上部誤タップ防止のため4ボタンも下部ドックへ配置） */}
        <nav
          className={`bg-sumi text-washi border-t border-kin/40 px-3 safe-bottom-nav shrink-0 z-30 ${
            isIOS ? 'pt-1.5' : 'pt-2'
          }`}
        >
          {isIOS && <div className="mb-1.5">{actionButtonsRow}</div>}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('map')}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-2xl font-serif font-bold text-xs transition ${
                activeTab === 'map'
                  ? 'bg-shuiro text-washi shadow-md border border-kin/40'
                  : 'text-washi/70 hover:text-washi'
              }`}
            >
              <Compass className="w-4 h-4" />
              <span>探す</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('concierge')}
              className={`relative flex items-center justify-center gap-1.5 py-2.5 rounded-2xl font-serif font-bold text-xs transition ${
                activeTab === 'concierge'
                  ? 'bg-shuiro text-washi shadow-md border border-kin/40'
                  : 'text-washi/70 hover:text-washi'
              }`}
            >
              <Sparkles className="w-4 h-4 text-kin" />
              <span>AIコース</span>
              {(favoriteRecords || []).length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-sumi text-[10px] font-sans font-black">
                  {(favoriteRecords || []).length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('album')}
              className={`relative flex items-center justify-center gap-1.5 py-2.5 rounded-2xl font-serif font-bold text-xs transition ${
                activeTab === 'album'
                  ? 'bg-shuiro text-washi shadow-md border border-kin/40'
                  : 'text-washi/70 hover:text-washi'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>御朱印帳</span>
              {visitedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-kin text-sumi text-[10px] font-sans font-black">
                  {visitedCount}
                </span>
              )}
            </button>
          </div>
        </nav>

        <SpotBottomSheet
          spot={selectedSpot}
          visitRecord={selectedSpot ? visitMap[selectedSpot.id] : null}
          favoriteRecord={selectedSpot ? favoriteMap[selectedSpot.id] : null}
          allVisits={visitRecords || []}
          books={goshuinBooks || []}
          onClose={() => setSelectedSpot(null)}
          onSaved={() => {}}
          onOpenAiSettings={() => setIsAiModalOpen(true)}
        />

        <PastGoshuinModal
          isOpen={isAddPastModalOpen}
          onClose={() => setIsAddPastModalOpen(false)}
          allSpots={mergedSpots}
          books={goshuinBooks || []}
          userLocation={userLocation}
          onRegistered={() => setActiveTab('album')}
          onOpenAiSettings={() => setIsAiModalOpen(true)}
        />

        <CoupleSyncModal
          isOpen={isCoupleModalOpen}
          onClose={() => setIsCoupleModalOpen(false)}
          onSyncSuccess={(res) => {
            setIsCoupleConnected(!res.disconnected);
            if (res.hasApiKeyNow) setHasApiKey(true);
          }}
        />

        <AiSettingsModal
          isOpen={isAiModalOpen}
          onClose={() => setIsAiModalOpen(false)}
          onUpdated={(hasKey) => setHasApiKey(hasKey)}
        />

        <DataBackupModal
          isOpen={isBackupModalOpen}
          onClose={() => setIsBackupModalOpen(false)}
          totalVisits={visitedCount}
          totalBooks={(goshuinBooks || []).length}
          onImportSuccess={() => {
            setActiveTab('album');
          }}
        />

        <GoogleMapsImportModal
          isOpen={isGmapImportModalOpen}
          onClose={() => setIsGmapImportModalOpen(false)}
          initialSharePayload={gmapImportPayload}
          allSpots={mergedSpots}
          userLocation={userLocation}
          favoriteMap={favoriteMap}
          onImportedSpot={handleImportedGmapSpot}
        />

        {/* どこからでもアプリを終了しようとした際に表示される確認アナウンス */}
        <ExitConfirmModal
          isOpen={isExitConfirmOpen}
          onClose={() => setIsExitConfirmOpen(false)}
        />
      </div>
    </div>
  );
}

/**
 * アプリのルートエントリーコンポーネント
 * 戻るボタン集中管理プロバイダー（BackHandlerProvider）で全体をラップ
 */
export default function App() {
  const [activeTab, setActiveTab] = useState('map');

  return (
    <BackHandlerProvider activeTab={activeTab} setActiveTab={setActiveTab}>
      <AppContent activeTab={activeTab} setActiveTab={setActiveTab} />
    </BackHandlerProvider>
  );
}
