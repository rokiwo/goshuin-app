import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Compass, BookOpen, MapPin, Sparkles, KeyRound, PlusCircle, Heart, HardDrive } from 'lucide-react';
import { db, getPlaceId, extractPrefectureFromSpot } from './db/database.js';
import { DEFAULT_CENTER, SEED_SPOTS } from './data/seedSpots.js';
import { fetchNearbyWorshipSpots, calculateDistanceKm } from './services/overpassApi.js';
import { calcDistanceMeters, formatDistanceLabel } from './services/shrineSearchService.js';
import { getGeminiApiKey } from './services/geminiService.js';
import {
  getSavedCouplePasscode,
  syncCoupleGoshuinData,
  syncCoupleIfConnectedThrottled
} from './services/coupleSyncService.js';
import MapView from './components/MapView.jsx';
import SpotBottomSheet from './components/SpotBottomSheet.jsx';
import AlbumView from './components/AlbumView.jsx';
import AiConciergeView from './components/AiConciergeView.jsx';
import AiSettingsModal from './components/AiSettingsModal.jsx';
import PastGoshuinModal from './components/PastGoshuinModal.jsx';
import CoupleSyncModal from './components/CoupleSyncModal.jsx';
import DataBackupModal from './components/DataBackupModal.jsx';
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

  // 過去の御朱印・お気に入り登録済み社寺・夫婦共有で追加されたカスタム寺社もマップのピン一覧に統合し、常に最新の現在地（userLocation）からの正確な距離を再計算する
  const mergedSpots = React.useMemo(() => {
    const attachLiveDistance = (spotObj) => {
      const lat = Number(spotObj.lat);
      const lng = Number(spotObj.lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return spotObj;
      const meters = calcDistanceMeters(userLocation.lat, userLocation.lng, lat, lng);
      return {
        ...spotObj,
        lat,
        lng,
        distanceMeters: meters,
        distanceKm: Math.round((meters / 1000) * 10) / 10,
        distanceLabel: formatDistanceLabel(meters)
      };
    };

    const updatedBaseSpots = spots.map(attachLiveDistance);
    const existingIds = new Set(updatedBaseSpots.map((s) => s.id));
    const customVisitedSpots = [];
    for (const rec of visitRecords || []) {
      const pid = getPlaceId(rec);
      const rLat = Number(rec.lat);
      const rLng = Number(rec.lng);
      if (rec.visited && !existingIds.has(pid) && !Number.isNaN(rLat) && !Number.isNaN(rLng)) {
        existingIds.add(pid);
        customVisitedSpots.push(
          attachLiveDistance({
            id: pid,
            name: rec.name,
            type: rec.type || 'shrine',
            denomination: rec.denomination || '参拝記録',
            address: rec.address || '',
            lat: rLat,
            lng: rLng,
            description: 'マイ御朱印帳に登録された参拝スポットです。',
            sampleGoshuin: rec.sampleGoshuin || [],
            hasGoshuin: true,
            goshuinConfidence: 'verified'
          })
        );
      }
    }

    const customFavoriteSpots = [];
    for (const fav of favoriteRecords || []) {
      const fLat = Number(fav.lat);
      const fLng = Number(fav.lng);
      if (fav.spotId && !existingIds.has(fav.spotId) && !Number.isNaN(fLat) && !Number.isNaN(fLng)) {
        existingIds.add(fav.spotId);
        customFavoriteSpots.push(
          attachLiveDistance({
            id: fav.spotId,
            name: fav.name,
            type: fav.type || 'shrine',
            denomination: fav.denomination || (fav.type === 'temple' ? '仏教（寺院）' : '神道（神社）'),
            address: fav.address || fav.prefecture || '',
            prefecture: fav.prefecture || '',
            lat: fLat,
            lng: fLng,
            description: `${fav.prefecture || ''}のお気に入りに登録された参拝スポットです。`,
            sampleGoshuin: fav.sampleGoshuin || [],
            hasGoshuin: true
          })
        );
      }
    }

    return [...updatedBaseSpots, ...customVisitedSpots, ...customFavoriteSpots];
  }, [spots, visitRecords, favoriteRecords, userLocation.lat, userLocation.lng]);

  // 選択中スポットにも常に最新の現在地からの距離を反映
  const liveSelectedSpot = React.useMemo(() => {
    if (!selectedSpot) return null;
    const sLat = Number(selectedSpot.lat);
    const sLng = Number(selectedSpot.lng);
    if (Number.isNaN(sLat) || Number.isNaN(sLng)) return selectedSpot;
    const meters = calcDistanceMeters(userLocation.lat, userLocation.lng, sLat, sLng);
    return {
      ...selectedSpot,
      lat: sLat,
      lng: sLng,
      distanceMeters: meters,
      distanceKm: Math.round((meters / 1000) * 10) / 10,
      distanceLabel: formatDistanceLabel(meters)
    };
  }, [selectedSpot, userLocation.lat, userLocation.lng]);

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

    const handleForegroundSync = () => {
      if (document.visibilityState === 'visible' && getSavedCouplePasscode()) {
        syncCoupleIfConnectedThrottled(6000)
          .then((res) => {
            if (res?.hasApiKeyNow) setHasApiKey(true);
          })
          .catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleForegroundSync);
    window.addEventListener('focus', handleForegroundSync);
    window.addEventListener('online', handleForegroundSync);

    const periodicTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && getSavedCouplePasscode()) {
        syncCoupleIfConnectedThrottled(25000).catch(() => {});
      }
    }, 45000);

    return () => {
      document.removeEventListener('visibilitychange', handleForegroundSync);
      window.removeEventListener('focus', handleForegroundSync);
      window.removeEventListener('online', handleForegroundSync);
      clearInterval(periodicTimer);
    };
  }, []);

  // お気に入りを使う画面（AIコース／地図のお気に入り絞込／御朱印帳）を開いた瞬間にも最新共有データを自動取得
  useEffect(() => {
    if (!isCoupleConnected) return;
    if (activeTab === 'concierge' || activeTab === 'album' || filterType === 'favorite') {
      syncCoupleIfConnectedThrottled(5000).catch(() => {});
    }
  }, [activeTab, filterType, isCoupleConnected]);

  const handleQuickSyncCouple = useCallback(async () => {
    if (!getSavedCouplePasscode()) return { ok: false, skipped: true };
    const res = await syncCoupleGoshuinData();
    if (res?.hasApiKeyNow) setHasApiKey(true);
    return res;
  }, []);

  const userLocationRef = useRef(userLocation);
  userLocationRef.current = userLocation;
  const hadRealGpsFixRef = useRef(false);

  // 指定座標から「指定半径」の神社・寺院をWikipedia Geosearch＋Overpass APIで並列検索（現在地距離は常にuserLocation基準）
  const loadNearbySpots = useCallback(async (lat, lng, radiusKmArg) => {
    const radiusKm =
      radiusKmArg || Number(localStorage.getItem('goshuin_search_radius_km')) || 10;
    setIsLoadingOverpass(true);
    setSearchCenter({ lat, lng });
    try {
      const curUser = userLocationRef.current;
      const result = await fetchNearbyWorshipSpots(
        lat,
        lng,
        radiusKm * 1000,
        curUser?.lat,
        curUser?.lng
      );
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

  // 初回高速測位（Wi-Fi/基地局）＋高精度GPS継続追跡（watchPosition）で現在地ズレ・タイムアウトを防止
  useEffect(() => {
    if (!navigator.geolocation) {
      loadNearbySpots(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
      return;
    }

    let unmounted = false;

    const applyGpsFix = (pos) => {
      if (unmounted || !pos?.coords) return;
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy || 999;
      if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
        return;
      }

      const prev = userLocationRef.current;
      const movedMeters = prev?.isFallback
        ? Infinity
        : calcDistanceMeters(prev.lat, prev.lng, lat, lng);
      const improvedAccuracy = (prev?.accuracy || 9999) - accuracy > 40;

      if (!hadRealGpsFixRef.current) {
        hadRealGpsFixRef.current = true;
        setUserLocation({ lat, lng, accuracy, isFallback: false });
        setFlyTarget({ lat, lng, zoom: 13 });
        loadNearbySpots(lat, lng);
      } else if (movedMeters >= 25 || improvedAccuracy) {
        setUserLocation({ lat, lng, accuracy, isFallback: false });
      }
    };

    // 1. 屋内でも1秒以内に返る高速ネットワーク測位を先行実行
    navigator.geolocation.getCurrentPosition(
      applyGpsFix,
      () => {
        // 高精度watchPosition側でリトライするため即座には諦めない
      },
      {
        enableHighAccuracy: false,
        timeout: 4500,
        maximumAge: 120000
      }
    );

    // 2. 高精度GPSで移動中もリアルタイム追跡（15秒待っても両方失敗した時のみ初期中心を読み込む）
    const fallbackTimer = setTimeout(() => {
      if (!unmounted && !hadRealGpsFixRef.current) {
        loadNearbySpots(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
      }
    }, 6500);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        clearTimeout(fallbackTimer);
        applyGpsFix(pos);
      },
      () => {
        if (!unmounted && !hadRealGpsFixRef.current) {
          clearTimeout(fallbackTimer);
          loadNearbySpots(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000
      }
    );

    return () => {
      unmounted = true;
      clearTimeout(fallbackTimer);
      navigator.geolocation.clearWatch(watchId);
    };
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

  // AIコース等から「指定県のお気に入りのみマップ表示」へジャンプ
  const handleShowPrefectureFavoritesOnMap = (prefecture) => {
    setSelectedSpot(null);
    setFlyTarget(null);
    setSelectedFavPrefecture(prefecture || 'ALL');
    setFilterType('favorite');
    setFavFitTrigger((n) => n + 1);
    setActiveTab('map');
  };

  // 現在地へ戻るボタン（タップ時に最新GPSを再測位して正確な現在地へ移動）
  const handleRecenterUser = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          hadRealGpsFixRef.current = true;
          setUserLocation({
            lat,
            lng,
            accuracy: pos.coords.accuracy || 50,
            isFallback: false
          });
          setFlyTarget({ lat, lng, zoom: 14 });
          loadNearbySpots(lat, lng);
        },
        () => {
          setFlyTarget({
            lat: userLocation.lat,
            lng: userLocation.lng,
            zoom: 13
          });
          loadNearbySpots(userLocation.lat, userLocation.lng);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
      return;
    }
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
              isCoupleConnected={isCoupleConnected}
              onQuickSyncCouple={handleQuickSyncCouple}
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
              onOpenAiSettings={() => setIsAiModalOpen(true)}
              isCoupleConnected={isCoupleConnected}
              onQuickSyncCouple={handleQuickSyncCouple}
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
          spot={liveSelectedSpot}
          userLocation={userLocation}
          visitRecord={liveSelectedSpot ? visitMap[liveSelectedSpot.id] : null}
          favoriteRecord={liveSelectedSpot ? favoriteMap[liveSelectedSpot.id] : null}
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
