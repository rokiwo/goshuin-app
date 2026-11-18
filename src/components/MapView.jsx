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
  ExternalLink
} from 'lucide-react';
import { searchShrineCandidatesByName } from '../services/shrineSearchService.js';
import { toggleFavoriteSpot, extractPrefectureFromSpot } from '../db/database.js';

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
 * 地図の中心座標をスムーズに移動させる内部コントローラー＋ドラッグ検知
 */
function MapController({ targetCoord, onMapMoved }) {
  const map = useMap();
  useEffect(() => {
    if (targetCoord && typeof targetCoord.lat === 'number' && typeof targetCoord.lng === 'number') {
      map.flyTo([targetCoord.lat, targetCoord.lng], targetCoord.zoom || map.getZoom(), {
        duration: 0.8
      });
    }
  }, [targetCoord, map]);

  useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      if (onMapMoved) {
        onMapMoved({ lat: c.lat, lng: c.lng });
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

  // ★Googleマップ上の全国神社・お寺キーワード検索＆お気に入り登録ステート
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingName, setIsSearchingName] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [pinnedSearchSpots, setPinnedSearchSpots] = useState([]);

  const currentTile = MAP_TILE_STYLES[tileStyleKey] || MAP_TILE_STYLES.google_road;

  const cycleTileStyle = () => {
    if (tileStyleKey === 'google_road') setTileStyleKey('google_hybrid');
    else if (tileStyleKey === 'google_hybrid') setTileStyleKey('osm');
    else setTileStyleKey('google_road');
  };

  // キーワード入力時のリアルタイム全国社寺検索（国土地理院＋OSM＋Wikipedia＋ローカル統合）
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setIsSearchingName(false);
      return;
    }

    let cancelled = false;
    setIsSearchingName(true);
    setIsSearchOpen(true);

    const timer = setTimeout(async () => {
      try {
        const list = await searchShrineCandidatesByName(
          q,
          '',
          spots,
          mapCenter || searchCenter || userLocation
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
    }, 280);

    return () => {
      cancelled = true;
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
    setPinnedSearchSpots((prev) => {
      if (prev.some((p) => p.id === spotObj.id)) return prev;
      return [spotObj, ...prev];
    });
    await toggleFavoriteSpot(spotObj);
  };

  // 地図をドラッグして一定距離離れたら「このエリアで寺社を検索」ボタンを表示
  const handleMapMoved = (newCenter) => {
    setMapCenter(newCenter);
    const baseLat = searchCenter?.lat ?? userLocation.lat;
    const baseLng = searchCenter?.lng ?? userLocation.lng;
    const diff = Math.hypot(newCenter.lat - baseLat, newCenter.lng - baseLng);
    setShowSearchHereBtn(diff > 0.025);
  };

  const handleSearchThisArea = () => {
    if (mapCenter && onSearchMapCenter) {
      setShowSearchHereBtn(false);
      onSearchMapCenter(mapCenter.lat, mapCenter.lng);
    }
  };

  // 既存の周辺スポット＋検索でピン留めしたスポットを統合
  const allMapSpots = React.useMemo(() => {
    const seen = new Set(spots.map((s) => s.id));
    const extras = pinnedSearchSpots.filter((p) => !seen.has(p.id));
    return [...extras, ...spots];
  }, [spots, pinnedSearchSpots]);

  const favoriteCountOnMap = React.useMemo(
    () => allMapSpots.filter((s) => Boolean(favoriteMap[s.id])).length,
    [allMapSpots, favoriteMap]
  );

  // フィルタ適用後のスポット一覧
  const filteredSpots = allMapSpots.filter((spot) => {
    if (filterType === 'shrine') return spot.type === 'shrine';
    if (filterType === 'temple') return spot.type === 'temple';
    if (filterType === 'favorite') return Boolean(favoriteMap[spot.id]);
    if (filterType === 'visited') return Boolean(visitMap[spot.id]?.visited);
    return true;
  });

  const activeCircleCenter = searchCenter || userLocation;

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden">
      {/* 上部フローティング：Googleマップ全国神社検索バー ＆ 種別フィルタピル ＆ 地図切替 */}
      <div className="absolute top-2.5 left-2.5 right-2.5 z-20 flex flex-col gap-1.5 pointer-events-none">
        {/* ★Googleマップ全国神社・お寺検索ボックス（お気に入りワンタップ登録付き） */}
        <div className="relative pointer-events-auto">
          <div className="flex items-center gap-1.5 bg-washi/95 backdrop-blur-md px-3 py-1.5 rounded-2xl border-2 border-kin shadow-xl">
            <Search className="w-4 h-4 text-shuiro shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => {
                if (searchQuery.trim().length >= 2) setIsSearchOpen(true);
              }}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="神社・お寺を全国検索 (例: 伊勢神宮、京都 八坂神社)"
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
                className="p-1 rounded-full hover:bg-sumi/10 text-sumi-muted shrink-0"
                title="検索クリア"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 検索候補ドロップダウン（都道府県バッジ＆★お気に入りボタン付き） */}
          {isSearchOpen && searchQuery.trim().length >= 2 && (
            <div className="mt-1.5 max-h-64 overflow-y-auto rounded-2xl bg-washi/98 backdrop-blur-md border-2 border-kin shadow-2xl divide-y divide-washi-border animate-slide-up">
              <div className="px-3 py-1.5 bg-sumi text-washi flex items-center justify-between text-[10px] font-serif">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-kin" />
                  {isSearchingName
                    ? `「${searchQuery.trim()}」を全国検索中...`
                    : `検索結果 ${searchResults.length}件（★でお気に入り保存・県別整理）`}
                </span>
                <button
                  type="button"
                  onClick={() => setIsSearchOpen(false)}
                  className="text-kin font-bold hover:underline"
                >
                  閉じる
                </button>
              </div>

              {!isSearchingName && searchResults.length === 0 ? (
                <div className="p-3 text-center space-y-2">
                  <p className="text-xs text-sumi-muted">
                    アプリ内マップ候補で見つかりませんでした。
                  </p>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      searchQuery.trim()
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-shuiro text-washi text-xs font-serif font-bold shadow"
                  >
                    <span>Googleマップ本家で「{searchQuery.trim()}」を開く</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                searchResults.map((cand) => {
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
                            ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                            : 'bg-washi border-kin/50 text-sumi hover:border-amber-500'
                        }`}
                        title="お気に入りに登録して都道府県別に保存"
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            isFav ? 'fill-white text-white' : 'text-amber-500'
                          }`}
                        />
                        <span>{isFav ? '登録済' : 'お気に入り'}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-1.5 pointer-events-auto">
          <div className="flex items-center gap-1 bg-sumi/90 backdrop-blur-md p-1 rounded-full border border-kin/30 shadow-lg overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => onFilterChange('all')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition whitespace-nowrap ${
                filterType === 'all'
                  ? 'bg-kin text-sumi font-bold shadow-sm'
                  : 'text-washi/80 hover:text-washi'
              }`}
            >
              全社寺 ({allMapSpots.length})
            </button>
            <button
              type="button"
              onClick={() => onFilterChange('favorite')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition flex items-center gap-1 whitespace-nowrap ${
                filterType === 'favorite'
                  ? 'bg-amber-500 text-white font-bold shadow-sm'
                  : 'text-amber-300 hover:text-amber-200'
              }`}
            >
              <Star className="w-3 h-3 fill-current" />
              お気に入り ({favoriteCountOnMap})
            </button>
            <button
              type="button"
              onClick={() => onFilterChange('shrine')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition flex items-center gap-1 whitespace-nowrap ${
                filterType === 'shrine'
                  ? 'bg-shuiro text-washi font-bold shadow-sm'
                  : 'text-washi/80 hover:text-washi'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-shuiro inline-block border border-washi/60" />
              神社 ({allMapSpots.filter((s) => s.type === 'shrine').length})
            </button>
            <button
              type="button"
              onClick={() => onFilterChange('temple')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition flex items-center gap-1 whitespace-nowrap ${
                filterType === 'temple'
                  ? 'bg-tera text-washi font-bold shadow-sm'
                  : 'text-washi/80 hover:text-washi'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-tera inline-block border border-washi/60" />
              寺院 ({allMapSpots.filter((s) => s.type === 'temple').length})
            </button>
            <button
              type="button"
              onClick={() => onFilterChange('visited')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition whitespace-nowrap ${
                filterType === 'visited'
                  ? 'bg-kin text-sumi font-bold shadow-sm'
                  : 'text-washi/80 hover:text-washi'
              }`}
            >
              参拝済
            </button>
          </div>

          {/* 地図レイヤー切替（Googleマップ / 航空写真）＋現在地＋再検索ボタン */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={cycleTileStyle}
              title="地図の表示スタイル切替（Googleマップ / 航空写真）"
              className="px-2.5 h-9 rounded-full bg-washi text-sumi border border-kin/50 shadow-lg flex items-center gap-1 text-[10px] font-bold active:scale-95 transition"
            >
              <Layers className="w-3.5 h-3.5 text-shuiro" />
              <span>{currentTile.label}</span>
            </button>
            <button
              type="button"
              onClick={onRecenterUser}
              title="現在地へ移動"
              className="w-9 h-9 rounded-full bg-washi text-sumi border border-kin/40 shadow-lg flex items-center justify-center active:scale-95 transition"
            >
              <Navigation className="w-4 h-4 text-shuiro" />
            </button>
            <button
              type="button"
              onClick={onRefreshNearby}
              disabled={isLoading}
              title="周辺を再検索"
              className="w-9 h-9 rounded-full bg-sumi text-kin border border-kin/40 shadow-lg flex items-center justify-center active:scale-95 transition disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 検索範囲（半径 5km / 10km / 15km / 20km）指定バー */}
        <div className="flex items-center justify-between gap-1.5 pointer-events-auto bg-sumi/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-kin/30 shadow-md">
          <span className="text-[10px] font-serif font-bold text-kin flex items-center gap-1 shrink-0">
            <Search className="w-3 h-3 text-shuiro" />
            検索範囲:
          </span>
          <div className="flex items-center gap-1">
            {[5, 10, 15, 20].map((km) => (
              <button
                key={km}
                type="button"
                onClick={() => onChangeRadius && onChangeRadius(km)}
                disabled={isLoading}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition ${
                  searchRadiusKm === km
                    ? 'bg-shuiro text-washi shadow-sm scale-105'
                    : 'text-washi/80 hover:text-washi hover:bg-white/10'
                }`}
              >
                半径{km}km
              </button>
            ))}
          </div>
        </div>

        {/* 地図をスクロールした際に表示される「このエリアで寺社を検索」ボタン */}
        {showSearchHereBtn && !isLoading && (
          <button
            type="button"
            onClick={handleSearchThisArea}
            className="self-center pointer-events-auto bg-shuiro text-washi text-xs font-serif font-bold px-4 py-2 rounded-full border border-kin shadow-xl flex items-center gap-1.5 active:scale-95 transition"
          >
            <Search className="w-3.5 h-3.5 text-kin" />
            <span>この地図エリアの神社・お寺をすべて検索</span>
          </button>
        )}

        {/* 検索中インジケーター */}
        {isLoading && (
          <div className="self-center pointer-events-auto bg-sumi/90 text-washi text-xs px-3.5 py-1.5 rounded-full border border-kin/40 shadow-md flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-kin animate-pulse" />
            <span>周辺の神社・お寺を一括取得中...</span>
          </div>
        )}
      </div>

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

          <MapController targetCoord={flyTarget} onMapMoved={handleMapMoved} />

          {/* 検索範囲サークル */}
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
                  click: () => onSelectSpot(spot)
                }}
              />
            );
          })}
        </MapContainer>
      </div>

      {/* 下部横スクロール：周辺寺社クイックカードリスト（最大80件までスムーズ表示） */}
      <div className="absolute bottom-3 left-0 right-0 z-20 pointer-events-none">
        <div className="flex items-stretch gap-3 overflow-x-auto no-scrollbar px-3 pb-1 pointer-events-auto">
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
                className={`text-left shrink-0 w-64 rounded-2xl p-3 transition shadow-xl border backdrop-blur-md flex flex-col justify-between cursor-pointer ${
                  selectedSpot?.id === spot.id
                    ? 'bg-washi border-shuiro ring-2 ring-shuiro/40'
                    : 'bg-washi/95 border-kin/40 hover:border-kin'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-washi ${
                          isShrine ? 'bg-shuiro' : 'bg-tera'
                        }`}
                      >
                        {isShrine ? '神社' : '寺院'}
                      </span>
                      {spot.hasGoshuin && (
                        <span className="px-1.5 py-0.5 rounded bg-kin/20 text-kin-dark text-[9px] font-bold">
                          御朱印人気
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => handleToggleFav(e, spot)}
                        title={isFavorite ? 'お気に入り解除' : 'お気に入りに登録'}
                        className={`p-1 rounded-full border transition ${
                          isFavorite
                            ? 'bg-amber-500 text-white border-amber-600'
                            : 'bg-washi text-amber-500 border-kin/40 hover:bg-amber-50'
                        }`}
                      >
                        <Star className={`w-3 h-3 ${isFavorite ? 'fill-white' : ''}`} />
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
                      <span className="text-[11px] font-medium text-sumi-muted">
                        {spot.distanceKm != null ? `${spot.distanceKm}km` : ''}
                      </span>
                    </div>
                  </div>

                  <h3 className="font-serif font-bold text-base text-sumi truncate">
                    {spot.name}
                  </h3>
                  <p className="text-[11px] text-sumi-muted truncate mt-0.5">
                    {spot.denomination}
                  </p>
                </div>

                <div className="mt-2 pt-2 border-t border-washi-border flex items-center justify-between text-[11px] text-sumi-muted">
                  <span className="truncate flex items-center gap-1 max-w-[165px]">
                    <MapPin className="w-3 h-3 text-shuiro shrink-0" />
                    {spot.address}
                  </span>
                  <span className="text-shuiro font-serif font-bold shrink-0">
                    御朱印を見る →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
