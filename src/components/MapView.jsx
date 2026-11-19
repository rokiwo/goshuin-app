import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import {
  Navigation,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  Camera,
  MapPin,
  Layers,
  Search,
  Star,
  X,
  Loader2,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  searchShrineCandidatesByName,
  isJapaneseAddressQuery,
  filterAndGroupCandidatesByPrefecture
} from '../services/shrineSearchService.js';
import {
  toggleFavoriteSpot,
  extractPrefectureFromSpot,
  groupFavoritesByPrefecture
} from '../db/database.js';

// 地図タイルレイヤー定義（デフォルト：見やすいGoogleマップ日本語標準地図）
const MAP_TILE_STYLES = {
  google_road: {
    id: 'google_road',
    label: 'Googleマップ',
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=ja',
    attribution: '&copy; Google Maps'
  },
  google_hybrid: {
    id: 'google_hybrid',
    label: '航空写真',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=ja',
    attribution: '&copy; Google Maps Satellite'
  },
  osm: {
    id: 'osm',
    label: 'OSM地図',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap'
  }
};

/**
 * 神社（朱色鳥居）とお寺（緑色寺院）、および参拝済みバッジ付きのカスタムSVGピンを生成する関数
 */
function createCustomSpotIcon(spot, visitRecord, isSelected, isFavorite = false) {
  const isShrine = spot.type === 'shrine';
  const isVisited = Boolean(visitRecord?.visited);
  const bgColor = isShrine ? '#c93a40' : '#2d6a4f';
  const borderColor = isSelected ? '#c5a059' : isFavorite ? '#f59e0b' : '#fcfaf2';
  const scale = isSelected ? 1.18 : 1;

  // 鳥居アイコン (神社) または 寺院アイコン (お寺) のSVG
  const innerSvg = isShrine
    ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fcfaf2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
         <path d="M3 6c5 1.2 13 1.2 18 0" />
         <path d="M5 10h14" />
         <path d="M7 6v15" />
         <path d="M17 6v15" />
         <path d="M12 6v4" />
       </svg>`
    : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fcfaf2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
         <path d="M4 10c4-4 12-4 16 0" />
         <path d="M12 3v3" />
         <path d="M6 10v9h12v-9" />
         <path d="M3 19h18" />
         <path d="M10 14h4v5h-4z" />
       </svg>`;

  // 参拝済みの場合は右上に金縁・朱色の「済」ミニ印を表示
  const visitedBadge = isVisited
    ? `<div style="position:absolute;top:-5px;right:-6px;background:#c5a059;color:#1a1a1a;font-size:9px;font-weight:900;width:16px;height:16px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:1.5px solid #fcfaf2;box-shadow:0 2px 4px rgba(0,0,0,0.3);">済</div>`
    : '';

  // お気に入り登録済みの場合は左上に黄金の「★」ミニバッジを表示
  const favoriteBadge = isFavorite
    ? `<div style="position:absolute;top:-5px;left:-6px;background:#f59e0b;color:#ffffff;font-size:9px;font-weight:900;width:16px;height:16px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:1.5px solid #fcfaf2;box-shadow:0 2px 4px rgba(0,0,0,0.3);">★</div>`
    : '';

  const html = `
    <div class="custom-pin-wrapper" style="position:relative;width:38px;height:46px;transform:scale(${scale});transform-origin:bottom center;">
      <div style="
        width:36px;
        height:36px;
        border-radius:9999px;
        background:${bgColor};
        border:2.5px solid ${borderColor};
        box-shadow:0 4px 10px rgba(26,26,26,0.35);
        display:flex;
        align-items:center;
        justify-content:center;
      ">
        ${innerSvg}
      </div>
      <div style="
        width:0;
        height:0;
        border-left:6px solid transparent;
        border-right:6px solid transparent;
        border-top:9px solid ${bgColor};
        margin:-2px auto 0 auto;
      "></div>
      ${visitedBadge}
      ${favoriteBadge}
    </div>
  `;

  return L.divIcon({
    className: 'bg-transparent border-0',
    html,
    iconSize: [38, 46],
    iconAnchor: [19, 44]
  });
}

/**
 * 現在地を示す青いパルスマーカー
 */
const userLocationIcon = L.divIcon({
  className: 'bg-transparent border-0',
  html: `
    <div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;width:22px;height:22px;border-radius:9999px;background:rgba(59,130,246,0.35);animation:ping 1.8s cubic-bezier(0,0,0.2,1) infinite;"></div>
      <div style="position:relative;width:12px;height:12px;border-radius:9999px;background:#2563eb;border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>
    </div>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 11]
});

/**
 * 地図の中心座標をスムーズに移動させる内部コントローラー＋ドラッグ検知＋空き領域クリック検出＋県別フィット
 */
function MapController({ targetCoord, boundsTarget, onMapMoved, onMapMovestart, onMapBlankClick }) {
  const map = useMap();
  useEffect(() => {
    if (targetCoord && typeof targetCoord.lat === 'number' && typeof targetCoord.lng === 'number') {
      map.flyTo([targetCoord.lat, targetCoord.lng], targetCoord.zoom || map.getZoom(), {
        duration: 0.8
      });
    }
  }, [targetCoord, map]);

  useEffect(() => {
    if (!boundsTarget || !Array.isArray(boundsTarget.coords) || boundsTarget.coords.length === 0) {
      return;
    }
    const valid = boundsTarget.coords.filter(
      (c) =>
        typeof c.lat === 'number' &&
        typeof c.lng === 'number' &&
        !Number.isNaN(c.lat) &&
        !Number.isNaN(c.lng)
    );
    if (valid.length === 0) return;

    if (valid.length === 1) {
      map.flyTo([valid[0].lat, valid[0].lng], 14, { duration: 0.7 });
      return;
    }

    const bounds = L.latLngBounds(valid.map((c) => [c.lat, c.lng]));
    map.fitBounds(bounds, {
      paddingTopLeft: [36, 100],
      paddingBottomRight: [36, 175],
      maxZoom: 14,
      animate: true
    });
  }, [boundsTarget, map]);

  useMapEvents({
    movestart: () => {
      if (onMapMovestart) onMapMovestart();
    },
    moveend: () => {
      const c = map.getCenter();
      if (onMapMoved) {
        onMapMoved({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
      }
    },
    click: () => {
      if (onMapBlankClick) {
        onMapBlankClick();
      }
    }
  });

  return null;
}

export default function MapView({
  userLocation,
  searchCenter,
  spots,
  visitMap,
  favoriteMap = {},
  selectedSpot,
  onSelectSpot,
  onFlyToSpot,
  filterType,
  onFilterChange,
  selectedFavPrefecture = 'ALL',
  onChangeFavPrefecture,
  favFitTrigger = 0,
  isLoading,
  onRefreshNearby,
  onSearchMapCenter,
  flyTarget,
  onRecenterUser,
  searchRadiusKm = 10,
  onChangeRadius
}) {
  // デフォルトで「Googleマップ（日本語標準）」を表示
  const [tileStyleKey, setTileStyleKey] = useState('google_road');
  const [mapCenter, setMapCenter] = useState(null);
  const [showSearchHereBtn, setShowSearchHereBtn] = useState(false);

  // ★県別お気に入り表示時の自動フィット＆ローカルフォールバックステート
  const [internalFavPref, setInternalFavPref] = useState('ALL');
  const activeFavPref = onChangeFavPrefecture ? selectedFavPrefecture : internalFavPref;
  const setActiveFavPref = onChangeFavPrefecture || setInternalFavPref;
  const [boundsTarget, setBoundsTarget] = useState(null);
  const [manualFavFitCount, setManualFavFitCount] = useState(0);
  const lastFavFitSigRef = useRef('');

  // ★全国神社・お寺＆住所コピペ検索ステート
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingName, setIsSearchingName] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchPrefFilter, setSearchPrefFilter] = useState('');
  const [pinnedSearchSpots, setPinnedSearchSpots] = useState([]);

  // ★マップを広く見せるための上部フィルタパネル＆下部カードリストの開閉ステート（デフォルトはスッキリ格納して地図を広く表示）
  const [isToolsExpanded, setIsToolsExpanded] = useState(false);
  const [isBottomCardsMinimized, setIsBottomCardsMinimized] = useState(false);

  const autoSearchTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (autoSearchTimerRef.current) clearTimeout(autoSearchTimerRef.current);
    };
  }, []);

  const currentTile = MAP_TILE_STYLES[tileStyleKey] || MAP_TILE_STYLES.google_road;

  const cycleTileStyle = () => {
    if (tileStyleKey === 'google_road') setTileStyleKey('google_hybrid');
    else if (tileStyleKey === 'google_hybrid') setTileStyleKey('osm');
    else setTileStyleKey('google_road');
  };

  // キーワード＆住所コピペ時のリアルタイム全国社寺検索（ローカル即時＋無料公開API逐次反映）
  useEffect(() => {
    const q = searchQuery.trim();
    setSearchPrefFilter('');
    if (q.length < 2) {
      setSearchResults([]);
      setIsSearchingName(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const isAddrQuery = isJapaneseAddressQuery(q);
    setIsSearchingName(true);
    setIsSearchOpen(true);

    const timer = setTimeout(
      async () => {
        try {
          const list = await searchShrineCandidatesByName(
            q,
            '',
            spots,
            mapCenter || searchCenter || userLocation,
            {
              signal: controller.signal,
              onPartialResults: (partial) => {
                if (!cancelled && Array.isArray(partial) && partial.length > 0) {
                  setSearchResults(partial);
                }
              }
            }
          );
          if (!cancelled) {
            setSearchResults(list);
          }
        } catch {
          if (!cancelled) {
            setSearchResults([]);
          }
        } finally {
          if (!cancelled) {
            setIsSearchingName(false);
          }
        }
      },
      isAddrQuery ? 120 : 160
    );

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchQuery, spots, userLocation]);

  // 検索結果から神社をタップしてGoogleマップ上でジャンプ＆詳細を開く
  const handlePickSearchResult = (cand) => {
    const spotObj = {
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
    };

    // 検索で見つけたスポットを地図のピン一覧にも保持
    setPinnedSearchSpots((prev) => {
      if (prev.some((p) => p.id === spotObj.id)) return prev;
      return [spotObj, ...prev];
    });

    setIsSearchOpen(false);
    if (onFlyToSpot) {
      onFlyToSpot(spotObj);
    } else {
      onSelectSpot(spotObj);
    }
  };

  // 検索結果やカードからワンタップでお気に入り（★）登録・解除
  const handleToggleFav = async (e, cand) => {
    e.stopPropagation();
    const spotObj = {
      ...cand,
      id: cand.id,
      prefecture: cand.prefecture || extractPrefectureFromSpot(cand)
    };
    const wasFav = Boolean(favoriteMap[cand.id]);
    setPinnedSearchSpots((prev) => {
      if (prev.some((p) => p.id === spotObj.id)) return prev;
      return [spotObj, ...prev];
    });
    await toggleFavoriteSpot(spotObj);

    // 住所ピンポイント検索結果から新たにお気に入り登録した場合は、そのままマップ上へジャンプして反映を見やすくする
    if (!wasFav && searchResults.length === 1 && cand.isAddressExactMatch) {
      handlePickSearchResult(spotObj);
    }
  };

  const handleMapMovestart = () => {
    if (autoSearchTimerRef.current) {
      clearTimeout(autoSearchTimerRef.current);
      autoSearchTimerRef.current = null;
    }
  };

  // 地図をドラッグして一定距離離れたら自動で周辺社寺を取得（zoom>=11＆お気に入り絞込以外）
  const handleMapMoved = (newCenter) => {
    setMapCenter(newCenter);
    const baseLat = searchCenter?.lat ?? userLocation.lat;
    const baseLng = searchCenter?.lng ?? userLocation.lng;
    const diff = Math.hypot(newCenter.lat - baseLat, newCenter.lng - baseLng);
    const shouldShowBtn = diff > 0.025;
    setShowSearchHereBtn(shouldShowBtn);

    const autoThreshold = Math.max(0.035, (searchRadiusKm / 111) * 0.65);
    if (
      filterType !== 'favorite' &&
      !isLoading &&
      onSearchMapCenter &&
      (newCenter.zoom ?? 12) >= 11 &&
      diff > autoThreshold
    ) {
      if (autoSearchTimerRef.current) clearTimeout(autoSearchTimerRef.current);
      autoSearchTimerRef.current = setTimeout(() => {
        setShowSearchHereBtn(false);
        onSearchMapCenter(newCenter.lat, newCenter.lng);
      }, 850);
    }
  };

  const handleSearchThisArea = () => {
    if (autoSearchTimerRef.current) {
      clearTimeout(autoSearchTimerRef.current);
      autoSearchTimerRef.current = null;
    }
    if (mapCenter && onSearchMapCenter) {
      setShowSearchHereBtn(false);
      onSearchMapCenter(mapCenter.lat, mapCenter.lng);
    }
  };

  // 地図上の空白エリアタップ時は検索ドロップダウン・絞込パネルをスムーズに閉じる
  const handleMapBlankClick = () => {
    if (isSearchOpen) setIsSearchOpen(false);
    if (isToolsExpanded) setIsToolsExpanded(false);
  };

  // 既存の周辺スポット＋検索でピン留めしたスポットを統合
  const allMapSpots = React.useMemo(() => {
    const seen = new Set(spots.map((s) => s.id));
    const extras = pinnedSearchSpots.filter((p) => !seen.has(p.id));
    return [...extras, ...spots];
  }, [spots, pinnedSearchSpots]);

  // お気に入り社寺の都道府県を解決（ユーザー手動変更やDB保存済みの県名を最優先）
  const resolveSpotPrefecture = React.useCallback(
    (spot) =>
      favoriteMap[spot.id]?.prefecture || spot.prefecture || extractPrefectureFromSpot(spot),
    [favoriteMap]
  );

  const favoriteSpotsAll = React.useMemo(
    () =>
      allMapSpots
        .filter((s) => Boolean(favoriteMap[s.id]))
        .map((s) => ({ ...s, prefecture: resolveSpotPrefecture(s) })),
    [allMapSpots, favoriteMap, resolveSpotPrefecture]
  );

  const favoriteCountOnMap = favoriteSpotsAll.length;

  const favoritePrefGroups = React.useMemo(
    () => groupFavoritesByPrefecture(favoriteSpotsAll),
    [favoriteSpotsAll]
  );

  // お気に入り表示中のデフォルト都道府県（現在地/地図中心の県があれば優先、なければ最初の県）
  const pickDefaultFavPrefecture = React.useCallback(() => {
    if (favoritePrefGroups.length === 0) return 'ALL';
    const centerCoord = mapCenter || searchCenter || userLocation;
    const localPref = centerCoord ? extractPrefectureFromSpot(centerCoord) : '';
    if (localPref && favoritePrefGroups.some((g) => g.prefecture === localPref)) {
      return localPref;
    }
    return favoritePrefGroups[0].prefecture;
  }, [favoritePrefGroups, mapCenter, searchCenter, userLocation]);

  // もし選択中の県のお気に入りがすべて解除された場合、利用可能な県に自動フォールバック
  useEffect(() => {
    if (filterType !== 'favorite') return;
    if (favoritePrefGroups.length === 0) {
      if (activeFavPref !== 'ALL') setActiveFavPref('ALL');
      return;
    }
    if (
      activeFavPref !== 'ALL' &&
      !favoritePrefGroups.some((g) => g.prefecture === activeFavPref)
    ) {
      setActiveFavPref(favoritePrefGroups[0].prefecture);
    }
  }, [filterType, favoritePrefGroups, activeFavPref, setActiveFavPref]);

  // 「お気に入り」フィルタを有効化（自動的に「その1県だけ」に絞り、絞込パネルを閉じてマップを見やすくする）
  const handleActivateFavoriteFilter = () => {
    const hasValidPref =
      activeFavPref &&
      activeFavPref !== 'ALL' &&
      favoritePrefGroups.some((g) => g.prefecture === activeFavPref);
    const nextPref = hasValidPref ? activeFavPref : pickDefaultFavPrefecture();
    setActiveFavPref(nextPref);
    onFilterChange('favorite');
    setIsToolsExpanded(false);
    setManualFavFitCount((c) => c + 1);
  };

  const handleSelectFavPrefecture = (pref) => {
    setActiveFavPref(pref);
    setManualFavFitCount((c) => c + 1);
  };

  // フィルタ適用後のスポット一覧
  const filteredSpots = React.useMemo(
    () =>
      allMapSpots.filter((spot) => {
        if (filterType === 'shrine') return spot.type === 'shrine';
        if (filterType === 'temple') return spot.type === 'temple';
        if (filterType === 'favorite') {
          if (!favoriteMap[spot.id]) return false;
          if (activeFavPref && activeFavPref !== 'ALL') {
            return resolveSpotPrefecture(spot) === activeFavPref;
          }
          return true;
        }
        if (filterType === 'visited') return Boolean(visitMap[spot.id]?.visited);
        return true;
      }),
    [allMapSpots, filterType, favoriteMap, activeFavPref, resolveSpotPrefecture, visitMap]
  );

  // お気に入り表示や選択県の切替時、該当県のピン全体が収まる位置へ自動ズーム
  useEffect(() => {
    if (filterType !== 'favorite') {
      lastFavFitSigRef.current = '';
      return;
    }
    const coords = filteredSpots.filter(
      (s) =>
        typeof s.lat === 'number' &&
        typeof s.lng === 'number' &&
        !Number.isNaN(s.lat) &&
        !Number.isNaN(s.lng)
    );
    if (coords.length === 0) return;

    const sig = `${activeFavPref}:${favFitTrigger}:${manualFavFitCount}`;
    if (lastFavFitSigRef.current === sig) return;
    lastFavFitSigRef.current = sig;

    setBoundsTarget({
      key: `${sig}:${Date.now()}`,
      coords: coords.map((s) => ({ lat: s.lat, lng: s.lng }))
    });
  }, [filterType, activeFavPref, favFitTrigger, manualFavFitCount, filteredSpots]);

  const activeCircleCenter = searchCenter || userLocation;

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden">
      {/* 上部フローティング：普段は「検索バー1本＋絞込ボタン」だけでマップを最大限広く見せる */}
      <div className="absolute top-2 left-2.5 right-2.5 z-30 flex flex-col gap-1.5 pointer-events-none">
        {/* ★1行目：全国神社・お寺＆住所コピペ検索ボックス ＋ 絞り込み開閉ボタン */}
        <div className="relative pointer-events-auto">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0 flex items-center gap-1.5 bg-washi/95 backdrop-blur-md px-3 py-1.5 rounded-2xl border-2 border-kin shadow-lg">
              <Search className="w-4 h-4 text-shuiro shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onFocus={() => {
                  setIsSearchOpen(true);
                }}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="神社・お寺名や住所（コピペ可）で検索"
                className="flex-1 bg-transparent text-xs font-serif font-bold text-sumi placeholder:text-sumi-muted/75 focus:outline-none min-w-0"
              />
              {isSearchingName && (
                <Loader2 className="w-3.5 h-3.5 text-shuiro animate-spin shrink-0" />
              )}
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                    setIsSearchOpen(false);
                  }}
                  className="p-0.5 rounded-full hover:bg-sumi/10 text-sumi-muted shrink-0"
                  title="検索クリア"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 絞り込み・検索範囲の開閉ボタン */}
            <button
              type="button"
              onClick={() => setIsToolsExpanded((prev) => !prev)}
              className={`px-2.5 py-2 rounded-2xl border-2 text-[11px] font-serif font-bold shadow-lg flex items-center gap-1 shrink-0 active:scale-95 transition whitespace-nowrap ${
                isToolsExpanded || filterType !== 'all'
                  ? 'bg-kin text-sumi border-sumi'
                  : 'bg-washi/95 text-sumi border-kin'
              }`}
              title="種別絞り込み・検索範囲を開く"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-shuiro shrink-0" />
              <span>絞込</span>
            </button>
          </div>

          {/* 検索候補ドロップダウン（都道府県ワンタップ絞込＆★お気に入りボタン付き） */}
          {isSearchOpen && searchQuery.trim().length >= 2 && (() => {
            const { prefOptions, hasMultiPrefs, visibleResults } =
              filterAndGroupCandidatesByPrefecture(searchResults, searchPrefFilter);

            return (
              <div className="mt-1.5 max-h-72 overflow-y-auto rounded-2xl bg-washi/95 backdrop-blur-md border-2 border-kin shadow-2xl divide-y divide-washi-border animate-slide-up">
                <div className="px-3 py-1.5 bg-sumi text-washi flex items-center justify-between text-[10px] font-serif sticky top-0 z-10">
                  <span className="flex items-center gap-1 min-w-0 truncate">
                    <Sparkles className="w-3 h-3 text-kin shrink-0" />
                    <span className="truncate">
                      {isSearchingName && searchResults.length === 0
                        ? isJapaneseAddressQuery(searchQuery)
                          ? '住所から神社・お寺を特定中...'
                          : `「${searchQuery.trim()}」を検索中...`
                        : !isSearchingName &&
                          searchResults.length === 1 &&
                          searchResults[0]?.isAddressExactMatch
                        ? '住所から場所を1件特定しました（タップで地図移動・★で登録）'
                        : isSearchingName
                        ? `候補 ${searchResults.length}件（追加取得中...）`
                        : `候補 ${visibleResults.length}件（タップで地図移動・★でお気に入り追加）`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsSearchOpen(false)}
                    className="text-kin font-bold hover:underline shrink-0 ml-2"
                  >
                    閉じる
                  </button>
                </div>

                {/* 複数都道府県に同名候補がある場合の1タップ絞り込みチップ */}
                {hasMultiPrefs && (
                  <div className="px-2.5 py-1.5 bg-washi-dark/60 flex items-center gap-1 overflow-x-auto no-scrollbar">
                    <button
                      type="button"
                      onClick={() => setSearchPrefFilter('')}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-serif font-bold whitespace-nowrap shrink-0 border transition ${
                        !searchPrefFilter
                          ? 'bg-sumi text-kin border-kin'
                          : 'bg-washi text-sumi border-kin/40 hover:border-kin'
                      }`}
                    >
                      すべて ({searchResults.length})
                    </button>
                    {prefOptions.map(([prefName, count]) => (
                      <button
                        key={prefName}
                        type="button"
                        onClick={() =>
                          setSearchPrefFilter((prev) => (prev === prefName ? '' : prefName))
                        }
                        className={`px-2 py-0.5 rounded-full text-[10px] font-serif font-bold whitespace-nowrap shrink-0 border transition ${
                          searchPrefFilter === prefName
                            ? 'bg-shuiro text-washi border-shuiro'
                            : 'bg-washi text-sumi border-kin/40 hover:border-amber-500'
                        }`}
                      >
                        {prefName} ({count})
                      </button>
                    ))}
                  </div>
                )}

                {!isSearchingName && visibleResults.length === 0 ? (
                  <div className="p-3 text-center">
                    <p className="text-xs text-sumi-muted leading-relaxed">
                      候補が見つかりませんでした。社寺名やGoogleマップの住所（例: 香川県東かがわ市松原69）をお試しください。
                    </p>
                  </div>
                ) : (
                  visibleResults.map((cand) => {
                    const isFav = Boolean(favoriteMap[cand.id]);
                    const isVisited = Boolean(visitMap[cand.id]?.visited);
                    const pref = cand.prefecture || extractPrefectureFromSpot(cand);
                    return (
                      <div
                        key={cand.id}
                        onClick={() => handlePickSearchResult(cand)}
                        className="p-2.5 hover:bg-washi-dark/70 transition flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-washi ${
                                cand.type === 'temple' ? 'bg-tera' : 'bg-shuiro'
                              }`}
                            >
                              {cand.type === 'temple' ? '寺院' : '神社'}
                            </span>
                            {pref && (
                              <span className="px-1.5 py-0.5 rounded bg-kin/25 text-sumi font-serif font-bold text-[10px]">
                                {pref}
                              </span>
                            )}
                            <span className="font-serif font-bold text-xs text-sumi truncate">
                              {cand.name}
                            </span>
                            {isVisited && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-shuiro/15 text-shuiro font-bold">
                                参拝済
                              </span>
                            )}
                            {cand.distanceLabel && (
                              <span className="text-[10px] text-kin-dark font-medium">
                                ({cand.distanceLabel})
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-sumi-muted truncate mt-0.5 flex items-center gap-1">
                            <MapPin className="w-2.5 h-2.5 text-shuiro shrink-0" />
                            <span>{cand.address}</span>
                          </p>
                        </div>

                        {/* ワンタップお気に入り登録ボタン */}
                        <button
                          type="button"
                          onClick={(e) => handleToggleFav(e, cand)}
                          className={`px-2.5 py-1.5 rounded-xl border text-[10px] font-serif font-bold flex items-center gap-1 shrink-0 active:scale-95 transition ${
                            isFav
                              ? 'bg-amber-400 text-sumi border-amber-600 shadow-sm'
                              : 'bg-washi border-kin/50 text-sumi hover:border-amber-500'
                          }`}
                          title="お気に入りに登録して都道府県別に保存"
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              isFav ? 'fill-sumi text-sumi' : 'text-amber-500'
                            }`}
                          />
                          <span>{isFav ? '登録済' : 'お気に入り'}</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })()}
        </div>

        {/* ★「お気に入り」表示中に出る県別ワンタップ切替バー（普段は隠れ、必要な県だけを見やすく表示） */}
        {filterType === 'favorite' && (
          <div className="pointer-events-auto flex items-center gap-1.5 bg-sumi/95 backdrop-blur-md px-2.5 py-1.5 rounded-2xl border-2 border-amber-400 shadow-xl overflow-x-auto no-scrollbar animate-slide-up">
            <span className="inline-flex items-center gap-1 text-[10px] font-serif font-bold text-amber-300 whitespace-nowrap shrink-0">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
              <span>県別:</span>
            </span>
            {favoritePrefGroups.length === 0 ? (
              <span className="text-[10px] text-washi whitespace-nowrap">
                お気に入りが未登録です（★で追加）
              </span>
            ) : (
              <>
                {favoritePrefGroups.map((grp) => {
                  const isSelected = activeFavPref === grp.prefecture;
                  return (
                    <button
                      key={grp.prefecture}
                      type="button"
                      onClick={() => handleSelectFavPrefecture(grp.prefecture)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-serif font-bold whitespace-nowrap shrink-0 flex items-center gap-1 transition active:scale-95 ${
                        isSelected
                          ? 'bg-amber-400 text-sumi shadow'
                          : 'bg-sumi-light text-washi border border-white/15 hover:bg-white/20'
                      }`}
                    >
                      <span>{grp.prefecture}</span>
                      <span
                        className={`px-1.5 rounded-full text-[10px] font-sans font-black ${
                          isSelected ? 'bg-sumi/20 text-sumi' : 'bg-black/40 text-amber-300'
                        }`}
                      >
                        {grp.count}
                      </span>
                    </button>
                  );
                })}
                {favoritePrefGroups.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleSelectFavPrefecture('ALL')}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-serif font-bold whitespace-nowrap shrink-0 transition active:scale-95 ${
                      activeFavPref === 'ALL'
                        ? 'bg-kin text-sumi shadow'
                        : 'bg-sumi-light text-washi border border-white/15 hover:bg-white/20'
                    }`}
                  >
                    全国({favoriteCountOnMap})
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => onFilterChange('all')}
              className="ml-auto px-2 py-1 rounded-full bg-shuiro/90 hover:bg-shuiro text-washi text-[10px] font-serif font-bold whitespace-nowrap shrink-0 flex items-center gap-0.5 active:scale-95 transition border border-white/20"
              title="お気に入り絞込を解除して全社寺表示に戻す"
            >
              <X className="w-3 h-3" />
              <span>解除</span>
            </button>
          </div>
        )}

        {/* ★「絞込」ボタンを押したときだけ開くコンパクト設定ドロワー（普段は隠してマップを広く表示） */}
        {isToolsExpanded && (
          <div className="pointer-events-auto rounded-2xl bg-sumi/95 backdrop-blur-md p-2.5 border border-kin/50 shadow-2xl space-y-2 animate-slide-up">
            {/* 種別フィルタ */}
            <div className="flex items-center justify-between gap-1 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => onFilterChange('all')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition whitespace-nowrap ${
                  filterType === 'all'
                    ? 'bg-kin text-sumi font-bold shadow-sm'
                    : 'text-washi/80 hover:text-washi'
                }`}
              >
                全社寺({allMapSpots.length})
              </button>
              <button
                type="button"
                onClick={handleActivateFavoriteFilter}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition flex items-center gap-1 whitespace-nowrap ${
                  filterType === 'favorite'
                    ? 'bg-amber-400 text-sumi font-bold shadow-sm'
                    : 'text-amber-300 hover:text-amber-200'
                }`}
              >
                <Star className="w-3 h-3 fill-current shrink-0" />
                <span>お気に入り({favoriteCountOnMap})</span>
              </button>
              <button
                type="button"
                onClick={() => onFilterChange('shrine')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition flex items-center gap-1 whitespace-nowrap ${
                  filterType === 'shrine'
                    ? 'bg-shuiro text-washi font-bold shadow-sm'
                    : 'text-washi/80 hover:text-washi'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-shuiro inline-block border border-washi/60 shrink-0" />
                <span>神社({allMapSpots.filter((s) => s.type === 'shrine').length})</span>
              </button>
              <button
                type="button"
                onClick={() => onFilterChange('temple')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition flex items-center gap-1 whitespace-nowrap ${
                  filterType === 'temple'
                    ? 'bg-tera text-washi font-bold shadow-sm'
                    : 'text-washi/80 hover:text-washi'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-tera inline-block border border-washi/60 shrink-0" />
                <span>寺院({allMapSpots.filter((s) => s.type === 'temple').length})</span>
              </button>
              <button
                type="button"
                onClick={() => onFilterChange('visited')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition whitespace-nowrap ${
                  filterType === 'visited'
                    ? 'bg-kin text-sumi font-bold shadow-sm'
                    : 'text-washi/80 hover:text-washi'
                }`}
              >
                参拝済
              </button>
            </div>

            {/* 検索範囲 ＆ 地図スタイル切替 */}
            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-washi/15">
              <div className="flex items-center gap-1 flex-1">
                <span className="text-[10px] font-serif font-bold text-kin shrink-0">
                  範囲:
                </span>
                {[5, 10, 15, 20].map((km) => (
                  <button
                    key={km}
                    type="button"
                    onClick={() => onChangeRadius && onChangeRadius(km)}
                    disabled={isLoading}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition whitespace-nowrap ${
                      searchRadiusKm === km
                        ? 'bg-shuiro text-washi shadow-sm'
                        : 'text-washi/80 hover:text-washi bg-white/5'
                    }`}
                  >
                    {km}km
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={cycleTileStyle}
                className="px-2.5 py-1 rounded-full bg-washi text-sumi border border-kin text-[10px] font-bold flex items-center gap-1 shrink-0"
              >
                <Layers className="w-3 h-3 text-shuiro" />
                <span>{currentTile.label}</span>
              </button>
            </div>
          </div>
        )}

        {/* 地図をスクロールした際に表示される「このエリアで寺社を検索」ボタン */}
        {showSearchHereBtn && !isLoading && filterType !== 'favorite' && (
          <button
            type="button"
            onClick={handleSearchThisArea}
            className="self-center pointer-events-auto bg-shuiro text-washi text-xs font-serif font-bold px-3.5 py-1.5 rounded-full border border-kin shadow-xl flex items-center gap-1.5 active:scale-95 transition"
          >
            <Search className="w-3.5 h-3.5 text-kin" />
            <span>このエリアの社寺を検索</span>
          </button>
        )}

        {/* 検索中インジケーター */}
        {isLoading && (
          <div className="self-center pointer-events-auto bg-sumi/90 text-washi text-[11px] px-3 py-1 rounded-full border border-kin/40 shadow-md flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-kin animate-pulse" />
            <span>周辺社寺を取得中...</span>
          </div>
        )}
      </div>

      {/* 右端フローティングのミニ操作ボタン（検索ドロップダウンや絞込展開時は隠して重なりを防止） */}
      {!isSearchOpen && !isToolsExpanded && (
        <div
          className={`absolute right-2.5 z-20 flex flex-col gap-1.5 pointer-events-auto transition-all ${
            filterType === 'favorite' ? 'top-24' : 'top-16'
          }`}
        >
          <button
            type="button"
            onClick={onRecenterUser}
            title="現在地へ移動"
            className="w-8 h-8 rounded-full bg-washi/95 text-sumi border border-kin shadow-lg flex items-center justify-center active:scale-95 transition"
          >
            <Navigation className="w-3.5 h-3.5 text-shuiro" />
          </button>
          <button
            type="button"
            onClick={onRefreshNearby}
            disabled={isLoading}
            title="周辺を再検索"
            className="w-8 h-8 rounded-full bg-sumi/90 text-kin border border-kin/50 shadow-lg flex items-center justify-center active:scale-95 transition disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      {/* Google マップ タイル統合マップ本体 */}
      <div className="flex-1 w-full h-full">
        <MapContainer
          center={[userLocation.lat, userLocation.lng]}
          zoom={12}
          zoomControl={false}
          className="w-full h-full"
        >
            <TileLayer
              key={currentTile.id}
              attribution={currentTile.attribution}
              url={currentTile.url}
              maxZoom={20}
            />

            <MapController
              targetCoord={flyTarget}
              boundsTarget={boundsTarget}
              onMapMoved={handleMapMoved}
              onMapMovestart={handleMapMovestart}
              onMapBlankClick={handleMapBlankClick}
            />

            {/* 検索範囲サークル（お気に入り県別表示時は非表示にして見やすくする） */}
            {filterType !== 'favorite' && (
              <Circle
                center={[activeCircleCenter.lat, activeCircleCenter.lng]}
                radius={searchRadiusKm * 1000}
                pathOptions={{
                  color: '#c93a40',
                  weight: 1.5,
                  dashArray: '6 6',
                  fillColor: '#c5a059',
                  fillOpacity: 0.03
                }}
              />
            )}

            {/* 現在地ピン */}
            <Marker position={[userLocation.lat, userLocation.lng]} icon={userLocationIcon} />

            {/* 各寺社のカスタムピン */}
            {filteredSpots.map((spot) => {
              const visitRecord = visitMap[spot.id];
              const isSelected = selectedSpot?.id === spot.id;
              const isFavorite = Boolean(favoriteMap[spot.id]);
              return (
                <Marker
                  key={spot.id}
                  position={[spot.lat, spot.lng]}
                  icon={createCustomSpotIcon(spot, visitRecord, isSelected, isFavorite)}
                  eventHandlers={{
                    click: () => {
                      onSelectSpot(spot);
                    }
                  }}
                />
              );
            })}
          </MapContainer>
      </div>

      {/* 下部横スクロール：周辺寺社クイックカードリスト（折りたたみ可能） */}
      <div className="absolute bottom-2.5 left-0 right-0 z-20 pointer-events-none flex flex-col items-center">
          {/* カードリストをたたむ / 広げるミニつまみ */}
          <button
            type="button"
            onClick={() => setIsBottomCardsMinimized((prev) => !prev)}
            className="pointer-events-auto mb-1.5 px-3 py-1 rounded-full bg-sumi/90 text-kin border border-kin/50 shadow-lg text-[10px] font-serif font-bold flex items-center gap-1 active:scale-95 transition"
          >
            {isBottomCardsMinimized ? (
              <>
                <ChevronUp className="w-3 h-3" />
                <span>
                  {filterType === 'favorite'
                    ? `${activeFavPref === 'ALL' ? '全国' : activeFavPref}のお気に入りを表示 (${filteredSpots.length}件)`
                    : `周辺社寺カードを表示 (${filteredSpots.length}件)`}
                </span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                <span>カードをたたんで地図を広く見る</span>
              </>
            )}
          </button>

          {!isBottomCardsMinimized && (
            <div className="w-full flex items-stretch gap-2.5 overflow-x-auto no-scrollbar px-3 pb-0.5 pointer-events-auto">
              {filteredSpots.slice(0, 80).map((spot) => {
                const visitRecord = visitMap[spot.id];
                const isVisited = Boolean(visitRecord?.visited);
                const hasPhoto = Boolean(visitRecord?.photoDataUrl);
                const isFavorite = Boolean(favoriteMap[spot.id]);
                const isShrine = spot.type === 'shrine';

                return (
                  <div
                    key={spot.id}
                    onClick={() => onSelectSpot(spot)}
                    className={`text-left shrink-0 w-56 rounded-2xl p-2.5 transition shadow-xl border backdrop-blur-md flex flex-col justify-between cursor-pointer ${
                      selectedSpot?.id === spot.id
                        ? 'bg-washi border-shuiro ring-2 ring-shuiro/40'
                        : 'bg-washi/95 border-kin/40 hover:border-kin'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <div className="flex items-center gap-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-washi ${
                              isShrine ? 'bg-shuiro' : 'bg-tera'
                            }`}
                          >
                            {isShrine ? '神社' : '寺院'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => handleToggleFav(e, spot)}
                            title={isFavorite ? 'お気に入り解除' : 'お気に入りに登録'}
                            className={`p-1 rounded-full border transition ${
                              isFavorite
                                ? 'bg-amber-400 text-sumi border-amber-600'
                                : 'bg-washi text-amber-500 border-kin/40 hover:bg-amber-50'
                            }`}
                          >
                            <Star className={`w-3 h-3 ${isFavorite ? 'fill-sumi text-sumi' : ''}`} />
                          </button>
                          {hasPhoto && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-kin-dark bg-kin/15 px-1.5 py-0.5 rounded">
                              <Camera className="w-3 h-3" />
                            </span>
                          )}
                          {isVisited && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-shuiro bg-shuiro/10 px-1.5 py-0.5 rounded border border-shuiro/30">
                              <CheckCircle2 className="w-3 h-3" /> 済
                            </span>
                          )}
                          <span className="text-[10px] font-medium text-sumi-muted">
                            {spot.distanceKm != null ? `${spot.distanceKm}km` : ''}
                          </span>
                        </div>
                      </div>

                      <h3 className="font-serif font-bold text-sm text-sumi truncate">
                        {spot.name}
                      </h3>
                    </div>

                    <div className="mt-1.5 pt-1.5 border-t border-washi-border flex items-center justify-between text-[10px] text-sumi-muted">
                      <span className="truncate flex items-center gap-0.5 max-w-[140px]">
                        <MapPin className="w-2.5 h-2.5 text-shuiro shrink-0" />
                        {spot.address}
                      </span>
                      <span className="text-shuiro font-serif font-bold shrink-0">
                        詳細 →
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}
