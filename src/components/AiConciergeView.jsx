import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Footprints,
  Train,
  Car,
  Clock,
  MapPin,
  CheckCircle2,
  Compass,
  Loader2,
  KeyRound,
  Star,
  Trash2,
  Search,
  Plus,
  ExternalLink,
  Navigation,
  Cpu,
  CheckSquare,
  Square
} from 'lucide-react';
import {
  generateAiPilgrimageRoute,
  generateFavoritePrefectureRoute,
  getGeminiApiKey
} from '../services/geminiService.js';
import {
  db,
  ALL_PREFECTURES,
  extractPrefectureFromSpot,
  groupFavoritesByPrefecture,
  saveFavoriteSpot,
  removeFavoriteSpot
} from '../db/database.js';
import { searchShrineCandidatesByName } from '../services/shrineSearchService.js';
import { useLiveQuery } from 'dexie-react-hooks';

/**
 * 【Gemini 4 Hydrogen 搭載】
 * 1. 都道府県別に整理された「お気に入り神社・お寺」の表示・検索追加・管理
 * 2. 選択した県のお気に入り神社を最適な順序で回る「Gemini 4 Hydrogen 最適巡拝ルート作成」
 * 3. 現在地周辺のおすすめ御朱印めぐりコース作成
 */
export default function AiConciergeView({
  userLocation,
  spots = [],
  favorites = [],
  visitMap = {},
  onSelectSpotOnMap,
  onShowPrefectureFavoritesOnMap,
  onOpenGmapImport,
  onOpenAiSettings
}) {
  // モード切替: 'favorites'（都道府県別お気に入り＆Gemini 4 Hydrogen最適巡拝ルート） | 'nearby'（現在地周辺モデルコース）
  const [routeMode, setRouteMode] = useState('favorites');

  // 都道府県ごとのお気に入りグループ
  const prefectureGroups = useMemo(
    () => groupFavoritesByPrefecture(favorites),
    [favorites]
  );

  // 現在選択されている都道府県
  const [selectedPrefecture, setSelectedPrefecture] = useState('');

  // 初回またはお気に入り変化時に、お気に入りがある最初の都道府県を自動選択
  useEffect(() => {
    if (prefectureGroups.length > 0) {
      const exists = prefectureGroups.some((g) => g.prefecture === selectedPrefecture);
      if (!exists) {
        setSelectedPrefecture(prefectureGroups[0].prefecture);
      }
    } else if (!selectedPrefecture) {
      setSelectedPrefecture('兵庫県');
    }
  }, [prefectureGroups, selectedPrefecture]);

  // 選択中の都道府県に属するお気に入り一覧
  const currentPrefFavorites = useMemo(() => {
    const found = prefectureGroups.find((g) => g.prefecture === selectedPrefecture);
    return found ? found.items : [];
  }, [prefectureGroups, selectedPrefecture]);

  // ルート計算に含めるスポットIDの選択セット（デフォルトは選択中の県の全お気に入り）
  const [checkedSpotIds, setCheckedSpotIds] = useState(new Set());

  useEffect(() => {
    setCheckedSpotIds(new Set(currentPrefFavorites.map((f) => f.spotId)));
  }, [selectedPrefecture, currentPrefFavorites.length]);

  const toggleCheckSpot = (spotId) => {
    setCheckedSpotIds((prev) => {
      const next = new Set(prev);
      if (next.has(spotId)) {
        next.delete(spotId);
      } else {
        next.add(spotId);
      }
      return next;
    });
  };

  // この画面からも直接神社を検索してお気に入りに追加できるクイック検索ステート
  const [quickQuery, setQuickQuery] = useState('');
  const [quickAreaFilter, setQuickAreaFilter] = useState('');
  const [quickCandidates, setQuickCandidates] = useState([]);
  const [isQuickSearching, setIsQuickSearching] = useState(false);

  useEffect(() => {
    const q = quickQuery.trim();
    if (q.length < 2) {
      setQuickCandidates([]);
      setIsQuickSearching(false);
      return;
    }

    let cancelled = false;
    setIsQuickSearching(true);

    const timer = setTimeout(async () => {
      try {
        const list = await searchShrineCandidatesByName(
          q,
          quickAreaFilter.trim(),
          spots,
          userLocation
        );
        if (!cancelled) {
          setQuickCandidates(list);
        }
      } catch {
        if (!cancelled) {
          setQuickCandidates([]);
        }
      } finally {
        if (!cancelled) {
          setIsQuickSearching(false);
        }
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [quickQuery, quickAreaFilter, spots, userLocation]);

  const handleAddCandidateToFavorite = async (cand) => {
    const pref = cand.prefecture || extractPrefectureFromSpot(cand);
    await saveFavoriteSpot({
      ...cand,
      id: cand.id,
      prefecture: pref
    });
    setSelectedPrefecture(pref);
  };

  // ルート作成オプション
  const [transportMode, setTransportMode] = useState('car');
  const [startTime, setStartTime] = useState('09:00');
  const [startPointNote, setStartPointNote] = useState('');
  const [durationHours, setDurationHours] = useState(3);

  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [currentRoute, setCurrentRoute] = useState(null);

  // 過去に生成したAIルート履歴をIndexedDBから取得
  const savedRoutes = useLiveQuery(
    () => db.aiRoutes.orderBy('createdAt').reverse().limit(8).toArray(),
    [],
    []
  );

  // ★Gemini 4 Hydrogen で「選択した都道府県のお気に入り神社」を最適な順番で回るルートを生成
  const handleGenerateFavoriteRoute = async () => {
    setErrorMsg('');
    if (!getGeminiApiKey()) {
      onOpenAiSettings();
      return;
    }

    const targetList = currentPrefFavorites.filter((f) => checkedSpotIds.has(f.spotId));
    if (targetList.length === 0) {
      setErrorMsg('ルートに含めるお気に入り神社にチェックを入れてください。');
      return;
    }

    try {
      setIsGenerating(true);
      const routePlan = await generateFavoritePrefectureRoute({
        prefecture: selectedPrefecture,
        favoriteSpots: targetList,
        userLocation,
        visitMap,
        transportMode,
        startTime,
        startPointNote
      });

      setCurrentRoute(routePlan);

      await db.aiRoutes.add({
        createdAt: new Date().toISOString(),
        areaName: `${selectedPrefecture}のお気に入り巡拝`,
        plan: routePlan
      });
    } catch (err) {
      if (err.message === 'API_KEY_MISSING') {
        onOpenAiSettings();
      } else {
        setErrorMsg(err.message || 'Gemini 4 Hydrogen ルート生成中にエラーが発生しました。');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // 現在地周辺のおすすめコース生成
  const handleGenerateNearbyCourse = async () => {
    setErrorMsg('');
    if (!getGeminiApiKey()) {
      onOpenAiSettings();
      return;
    }

    try {
      setIsGenerating(true);
      const routePlan = await generateAiPilgrimageRoute({
        userLocation,
        spots,
        visitMap,
        transportMode,
        durationHours
      });

      setCurrentRoute(routePlan);

      await db.aiRoutes.add({
        createdAt: new Date().toISOString(),
        areaName: userLocation.isFallback ? '明石・神戸周辺' : '現在地周辺',
        plan: routePlan
      });
    } catch (err) {
      if (err.message === 'API_KEY_MISSING') {
        onOpenAiSettings();
      } else {
        setErrorMsg(err.message || 'AIコース生成中にエラーが発生しました。');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // コース内のスポットをタップした際に地図上のピン＆ボトムシートへジャンプ
  const handleJumpToSpot = (step) => {
    const favMatch = favorites.find(
      (f) => f.spotId === step.spotId || f.name === step.spotName
    );
    if (favMatch) {
      onSelectSpotOnMap({
        ...favMatch,
        id: favMatch.spotId
      });
      return;
    }

    const matched =
      spots.find((s) => s.id === step.spotId) ||
      spots.find((s) => s.name === step.spotName);
    if (matched) {
      onSelectSpotOnMap(matched);
    }
  };

  const activePlan = currentRoute || savedRoutes?.[0]?.plan || null;

  // 生成されたルートの全スポットを順番通り繋いだ Googleマップ 複数経由地ナビURLを作成
  const buildGoogleMapsMultiStopUrl = (plan) => {
    if (!plan?.steps || plan.steps.length === 0) return '';
    const coordsOrNames = plan.steps.map((st) => {
      const fav = favorites.find(
        (f) => f.spotId === st.spotId || f.name === st.spotName
      );
      if (fav && typeof fav.lat === 'number' && typeof fav.lng === 'number') {
        return `${fav.lat},${fav.lng}`;
      }
      const sp = spots.find((s) => s.id === st.spotId || s.name === st.spotName);
      if (sp && typeof sp.lat === 'number' && typeof sp.lng === 'number') {
        return `${sp.lat},${sp.lng}`;
      }
      return `${st.spotName} ${plan.prefecture || ''}`.trim();
    });

    if (coordsOrNames.length === 1) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        coordsOrNames[0]
      )}`;
    }

    const origin = encodeURIComponent(coordsOrNames[0]);
    const destination = encodeURIComponent(coordsOrNames[coordsOrNames.length - 1]);
    const waypoints = coordsOrNames
      .slice(1, -1)
      .map((w) => encodeURIComponent(w))
      .join('|');
    const travelmode =
      transportMode === 'walk'
        ? 'walking'
        : transportMode === 'car'
        ? 'driving'
        : 'transit';

    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${
      waypoints ? `&waypoints=${waypoints}` : ''
    }&travelmode=${travelmode}`;
  };

  return (
    <div className="w-full h-full overflow-y-auto washi-pattern px-4 py-4 space-y-4">
      {/* 上部モード切り替えタブ：県別お気に入り最適ルート vs 現在地周辺コース */}
      <div className="p-1 rounded-2xl bg-sumi text-washi border border-kin/50 shadow-md grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => setRouteMode('favorites')}
          className={`py-2 px-2 rounded-xl font-serif font-bold text-xs flex items-center justify-center gap-1.5 transition ${
            routeMode === 'favorites'
              ? 'bg-shuiro text-washi shadow border border-kin/50'
              : 'text-washi/70 hover:text-washi'
          }`}
        >
          <Star className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
          <span>県別お気に入り巡拝 ({favorites.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setRouteMode('nearby')}
          className={`py-2 px-2 rounded-xl font-serif font-bold text-xs flex items-center justify-center gap-1.5 transition ${
            routeMode === 'nearby'
              ? 'bg-shuiro text-washi shadow border border-kin/50'
              : 'text-washi/70 hover:text-washi'
          }`}
        >
          <Compass className="w-3.5 h-3.5 text-kin" />
          <span>現在地周辺おまかせ</span>
        </button>
      </div>

      {routeMode === 'favorites' ? (
        <>
          {/* ★1. 神社を検索してお気に入りに追加＆都道府県別に整理カード */}
          <div className="rounded-2xl bg-washi border-2 border-kin/60 p-3.5 shadow-md space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm shrink-0">
                  <Star className="w-4 h-4 fill-white" />
                </div>
                <div>
                  <h2 className="font-serif font-black text-sm text-sumi">
                    県別お気に入り神社・お寺リスト
                  </h2>
                  <p className="text-[10px] text-sumi-muted">
                    検索してお気に入り登録すると自動で都道府県ごとに振り分けられます
                  </p>
                </div>
              </div>
              {onOpenGmapImport && (
                <button
                  type="button"
                  onClick={onOpenGmapImport}
                  className="px-2.5 py-1.5 rounded-xl bg-sumi text-kin border border-kin/50 text-[10px] font-serif font-bold shrink-0 active:scale-95 transition whitespace-nowrap"
                  title="本家Googleマップの共有リンクやURLから追加"
                >
                  Gマップ追加
                </button>
              )}
            </div>

            {/* 神社クイック検索＆お気に入り追加バー */}
            <div className="space-y-1.5">
              <div className="flex gap-1.5 min-w-0">
                <div className="flex-1 min-w-0 flex items-center gap-1.5 rounded-xl border border-kin/50 bg-washi-dark/60 px-2.5 py-1.5">
                  <Search className="w-3.5 h-3.5 text-shuiro shrink-0" />
                  <input
                    type="text"
                    value={quickQuery}
                    onChange={(e) => setQuickQuery(e.target.value)}
                    placeholder="行きたい神社を検索 (例: 出雲大社)"
                    className="w-full min-w-0 bg-transparent text-xs font-serif font-bold text-sumi focus:outline-none"
                  />
                  {isQuickSearching && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-shuiro shrink-0" />
                  )}
                </div>
                <input
                  type="text"
                  value={quickAreaFilter}
                  onChange={(e) => setQuickAreaFilter(e.target.value)}
                  placeholder="県名絞込"
                  className="w-20 shrink-0 rounded-xl border border-kin/40 bg-washi px-2 py-1.5 text-xs text-sumi focus:outline-none"
                />
              </div>

              {/* クイック検索候補リスト */}
              {quickQuery.trim().length >= 2 && (
                <div className="rounded-xl border border-kin/50 bg-washi max-h-48 overflow-y-auto divide-y divide-washi-border shadow-inner">
                  {isQuickSearching ? (
                    <div className="p-3 text-center text-xs text-sumi-muted flex items-center justify-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-shuiro" />
                      <span>全国の神社・お寺から「{quickQuery.trim()}」を検索中...</span>
                    </div>
                  ) : quickCandidates.length === 0 ? (
                    <div className="p-2.5 text-center text-[11px] text-sumi-muted">
                      候補が見つかりませんでした。県名や正式名称でお試しください。
                    </div>
                  ) : (
                    quickCandidates.map((cand) => {
                      const isFav = favorites.some((f) => f.spotId === cand.id);
                      const pref = cand.prefecture || extractPrefectureFromSpot(cand);
                      return (
                        <div
                          key={cand.id}
                          className="p-2 flex items-center justify-between gap-2 hover:bg-washi-dark/60"
                        >
                          <div
                            onClick={() =>
                              onSelectSpotOnMap({
                                ...cand,
                                id: cand.id,
                                prefecture: pref
                              })
                            }
                            className="min-w-0 flex-1 cursor-pointer"
                          >
                            <div className="flex items-center gap-1 flex-wrap">
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9px] font-bold text-washi ${
                                  cand.type === 'temple' ? 'bg-tera' : 'bg-shuiro'
                                }`}
                              >
                                {cand.type === 'temple' ? '寺院' : '神社'}
                              </span>
                              <span className="px-1.5 py-0.2 rounded bg-kin/25 text-sumi font-serif font-bold text-[10px]">
                                {pref}
                              </span>
                              <span className="font-serif font-bold text-xs text-sumi truncate">
                                {cand.name}
                              </span>
                            </div>
                            <p className="text-[10px] text-sumi-muted truncate mt-0.5">
                              {cand.address}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              isFav
                                ? removeFavoriteSpot(cand.id)
                                : handleAddCandidateToFavorite(cand)
                            }
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-serif font-bold flex items-center gap-1 shrink-0 transition ${
                              isFav
                                ? 'bg-amber-500 text-white'
                                : 'bg-sumi text-kin hover:bg-sumi-light'
                            }`}
                          >
                            {isFav ? (
                              <>
                                <Star className="w-3 h-3 fill-white" /> 追加済
                              </>
                            ) : (
                              <>
                                <Plus className="w-3 h-3" /> お気に入り追加
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* 都道府県タブピル一覧（お気に入り登録がある県をバッジ付きで表示） */}
            {prefectureGroups.length > 0 ? (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-serif font-bold text-sumi">
                    都道府県を選択（{prefectureGroups.length}都道府県に登録あり）:
                  </span>
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {prefectureGroups.map((grp) => {
                    const active = grp.prefecture === selectedPrefecture;
                    return (
                      <button
                        key={grp.prefecture}
                        type="button"
                        onClick={() => setSelectedPrefecture(grp.prefecture)}
                        className={`px-3 py-1.5 rounded-full text-xs font-serif font-bold flex items-center gap-1.5 shrink-0 transition ${
                          active
                            ? 'bg-shuiro text-washi shadow-md border border-kin'
                            : 'bg-washi-dark text-sumi border border-kin/40 hover:border-shuiro'
                        }`}
                      >
                        <span>{grp.prefecture}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded-full text-[10px] font-sans font-black ${
                            active ? 'bg-kin text-sumi' : 'bg-sumi/15 text-sumi'
                          }`}
                        >
                          {grp.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* 選択した都道府県のお気に入り神社リスト */}
                <div className="rounded-xl bg-washi-dark/70 border border-kin/40 p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-serif font-bold text-sumi flex items-center gap-1 min-w-0 truncate">
                      <MapPin className="w-3.5 h-3.5 text-shuiro shrink-0" />
                      <span className="truncate">
                        {selectedPrefecture}のお気に入り（{currentPrefFavorites.length}社寺）
                      </span>
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {onShowPrefectureFavoritesOnMap && currentPrefFavorites.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onShowPrefectureFavoritesOnMap(selectedPrefecture)}
                          className="px-2 py-0.5 rounded-lg bg-sumi text-kin border border-kin/50 text-[10px] font-serif font-bold flex items-center gap-1 active:scale-95 transition whitespace-nowrap"
                          title="この県のお気に入りだけをマップに表示"
                        >
                          <MapPin className="w-2.5 h-2.5" />
                          <span>地図で見る</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (checkedSpotIds.size === currentPrefFavorites.length) {
                            setCheckedSpotIds(new Set());
                          } else {
                            setCheckedSpotIds(
                              new Set(currentPrefFavorites.map((f) => f.spotId))
                            );
                          }
                        }}
                        className="text-[10px] font-serif font-bold text-shuiro hover:underline whitespace-nowrap"
                      >
                        {checkedSpotIds.size === currentPrefFavorites.length
                          ? 'すべて選択解除'
                          : 'すべて選択'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                    {currentPrefFavorites.map((fav) => {
                      const isChecked = checkedSpotIds.has(fav.spotId);
                      const isVisited = Boolean(visitMap[fav.spotId]?.visited);
                      return (
                        <div
                          key={fav.spotId}
                          className={`p-2 rounded-xl border transition flex items-center justify-between gap-2 ${
                            isChecked
                              ? 'bg-washi border-kin shadow-sm'
                              : 'bg-washi/50 border-washi-border opacity-70'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleCheckSpot(fav.spotId)}
                            className="text-shuiro shrink-0"
                            title="ルート計算に含める"
                          >
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-shuiro" />
                            ) : (
                              <Square className="w-4 h-4 text-sumi-muted" />
                            )}
                          </button>

                          <div
                            onClick={() =>
                              onSelectSpotOnMap({
                                ...fav,
                                id: fav.spotId
                              })
                            }
                            className="min-w-0 flex-1 cursor-pointer"
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9px] font-bold text-washi ${
                                  fav.type === 'temple' ? 'bg-tera' : 'bg-shuiro'
                                }`}
                              >
                                {fav.type === 'temple' ? '寺院' : '神社'}
                              </span>
                              <span className="font-serif font-bold text-xs text-sumi truncate">
                                {fav.name}
                              </span>
                              {isVisited && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded bg-shuiro/10 text-shuiro font-bold">
                                  参拝済
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-sumi-muted truncate mt-0.5">
                              {fav.address}
                            </p>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* 都道府県の変更セレクト（誤判定時にも手動変更可能） */}
                            <select
                              value={fav.prefecture || selectedPrefecture}
                              onChange={(e) =>
                                saveFavoriteSpot(
                                  { ...fav, id: fav.spotId },
                                  { prefecture: e.target.value }
                                )
                              }
                              className="rounded border border-kin/40 bg-washi px-1 py-0.5 text-[10px] font-serif text-sumi"
                              title="所属する都道府県を変更"
                            >
                              {ALL_PREFECTURES.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              onClick={() =>
                                onSelectSpotOnMap({
                                  ...fav,
                                  id: fav.spotId
                                })
                              }
                              className="p-1.5 rounded-lg bg-sumi text-kin text-[10px]"
                              title="Googleマップ上で見る"
                            >
                              <MapPin className="w-3 h-3" />
                            </button>

                            <button
                              type="button"
                              onClick={() => removeFavoriteSpot(fav.spotId)}
                              className="p-1.5 rounded-lg bg-shuiro/10 text-shuiro hover:bg-shuiro hover:text-washi transition"
                              title="お気に入りから削除"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-washi-dark/70 border border-dashed border-kin p-4 text-center space-y-1.5">
                <p className="font-serif font-bold text-xs text-sumi">
                  まだお気に入り神社が登録されていません
                </p>
                <p className="text-[11px] text-sumi-muted leading-relaxed">
                  上の検索欄、または「探す（Googleマップ）」タブの検索バー＆ピン詳細にある「★お気に入り」ボタンを押すと、県ごとに自動で整理されます。
                </p>
              </div>
            )}
          </div>

          {/* ★2. Gemini 4 Hydrogen API による「選択した県のお気に入り神社 最適巡拝ルート作成」パネル */}
          <div className="rounded-2xl bg-sumi text-washi p-4 border-2 border-kin shadow-xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-kin/20 border border-kin flex items-center justify-center text-kin shrink-0">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.2 rounded-full bg-kin text-sumi font-mono font-black text-[9px]">
                      gemini-4-hydrogen
                    </span>
                    <span className="text-[10px] text-kin font-serif font-bold">
                      最新AIルート最適化
                    </span>
                  </div>
                  <h3 className="font-serif font-bold text-sm text-washi mt-0.5">
                    {selectedPrefecture}のお気に入り神社 最適巡拝プランナー
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={onOpenAiSettings}
                className="px-2.5 py-1.5 rounded-xl bg-sumi-light border border-kin/40 text-[11px] text-washi flex items-center gap-1 hover:border-kin shrink-0"
              >
                <KeyRound className="w-3 h-3 text-kin" />
                AI設定
              </button>
            </div>

            {/* 移動手段の選択 */}
            <div className="space-y-1.5">
              <p className="text-[11px] text-washi/80 font-medium">1. 当日の移動手段</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'car', label: '車・ドライブ', icon: Car },
                  { id: 'walk_train', label: '電車・バス併用', icon: Train },
                  { id: 'walk', label: '徒歩メイン', icon: Footprints }
                ].map((item) => {
                  const Icon = item.icon;
                  const active = transportMode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTransportMode(item.id)}
                      className={`py-2 px-2 rounded-xl border text-xs font-serif font-bold flex flex-col items-center gap-1 transition ${
                        active
                          ? 'bg-shuiro text-washi border-kin shadow-md'
                          : 'bg-sumi-light text-washi/70 border-washi/15'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 出発時刻・出発地点（任意） */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-washi/80 block">2. 出発時刻</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-xl bg-sumi-light border border-kin/40 px-2.5 py-1.5 text-xs text-washi focus:outline-none"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-[10px] text-washi/80 block">
                  3. 出発駅・IC・ホテル等（任意）
                </label>
                <input
                  type="text"
                  value={startPointNote}
                  onChange={(e) => setStartPointNote(e.target.value)}
                  placeholder={`例: ${selectedPrefecture}の主要駅、自宅など`}
                  className="w-full rounded-xl bg-sumi-light border border-kin/40 px-2.5 py-1.5 text-xs text-washi placeholder:text-washi/40 focus:outline-none"
                />
              </div>
            </div>

            {/* Gemini 4 Hydrogen ルート生成ボタン */}
            <button
              type="button"
              disabled={isGenerating || checkedSpotIds.size === 0}
              onClick={handleGenerateFavoriteRoute}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-shuiro to-shuiro-dark text-washi font-serif font-bold text-xs sm:text-sm border border-kin shadow-lg flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-kin" />
                  <span>Gemini 4 Hydrogenが最適な参拝順序を計算中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-kin" />
                  <span>
                    {selectedPrefecture}のお気に入り({checkedSpotIds.size}件)の最適順序を算出
                  </span>
                </>
              )}
            </button>

            {errorMsg && (
              <div className="p-2.5 rounded-xl bg-shuiro/20 border border-shuiro text-washi text-xs">
                {errorMsg}
              </div>
            )}
          </div>
        </>
      ) : (
        /* 現在地周辺のおまかせモデルコースカード */
        <div className="rounded-2xl bg-sumi text-washi p-4 border-2 border-kin/60 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-kin/20 border border-kin flex items-center justify-center text-kin">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-serif font-bold text-base text-washi">
                  現在地周辺AIコース作成
                </h2>
                <p className="text-[11px] text-kin">
                  現在地周辺の{spots.length}社寺からおすすめコースを自動設計
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenAiSettings}
              className="px-2.5 py-1.5 rounded-xl bg-sumi-light border border-kin/40 text-[11px] text-washi flex items-center gap-1 hover:border-kin"
            >
              <KeyRound className="w-3 h-3 text-kin" />
              AI設定
            </button>
          </div>

          <div className="space-y-1.5 pt-1">
            <p className="text-[11px] text-washi/80 font-medium">1. 移動スタイルを選択</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'walk', label: '徒歩お散歩', icon: Footprints },
                { id: 'walk_train', label: '電車・バス併用', icon: Train },
                { id: 'car', label: '車・ドライブ', icon: Car }
              ].map((item) => {
                const Icon = item.icon;
                const active = transportMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTransportMode(item.id)}
                    className={`py-2 px-2 rounded-xl border text-xs font-serif font-bold flex flex-col items-center gap-1 transition ${
                      active
                        ? 'bg-shuiro text-washi border-kin shadow-md'
                        : 'bg-sumi-light text-washi/70 border-washi/15'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-washi/80 font-medium">2. 所要時間の目安</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { hours: 2, label: 'サクッと2時間' },
                { hours: 3, label: 'ゆったり3時間' },
                { hours: 5, label: '半日たっぷり5時間' }
              ].map((t) => (
                <button
                  key={t.hours}
                  type="button"
                  onClick={() => setDurationHours(t.hours)}
                  className={`py-1.5 px-2 rounded-xl border text-xs font-serif font-bold transition ${
                    durationHours === t.hours
                      ? 'bg-kin text-sumi border-washi shadow-sm'
                      : 'bg-sumi-light text-washi/70 border-washi/15'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={isGenerating}
            onClick={handleGenerateNearbyCourse}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-shuiro to-shuiro-dark text-washi font-serif font-bold text-sm border border-kin/50 shadow-lg flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-60"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-kin" />
                <span>Gemini AIが参拝ルートを設計中...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-kin" />
                <span>おすすめ御朱印めぐりコースをAI作成</span>
              </>
            )}
          </button>

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-shuiro/20 border border-shuiro text-washi text-xs">
              {errorMsg}
            </div>
          )}
        </div>
      )}

      {/* ★生成された最適巡拝ルートの表示 */}
      {activePlan ? (
        <div className="jabara-card rounded-2xl p-4 space-y-4 pb-6">
          <div className="border-b border-washi-border pb-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded bg-shuiro text-washi font-serif font-bold text-[10px]">
                  {activePlan.prefecture
                    ? `${activePlan.prefecture} 最適巡拝ルート`
                    : 'AIご提案モデルコース'}
                </span>
                {activePlan.modelUsed && (
                  <span className="px-2 py-0.5 rounded bg-sumi text-kin font-mono font-bold text-[9px]">
                    {activePlan.modelUsed}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs font-bold text-kin-dark">
                {activePlan.totalDistanceEstimate && (
                  <span>{activePlan.totalDistanceEstimate}</span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {activePlan.totalEstimatedTime}
                </span>
              </div>
            </div>

            <h3 className="font-serif font-black text-lg text-sumi leading-snug">
              {activePlan.courseTitle}
            </h3>
            <p className="text-xs text-sumi-muted leading-relaxed">
              {activePlan.concept}
            </p>

            {/* Googleマップの経路ナビ（複数経由地）で一発起動するボタン */}
            {buildGoogleMapsMultiStopUrl(activePlan) && (
              <div className="pt-1.5">
                <a
                  href={buildGoogleMapsMultiStopUrl(activePlan)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 px-3 rounded-xl bg-sumi text-kin border border-kin font-serif font-bold text-xs flex items-center justify-center gap-1.5 shadow active:scale-95 transition"
                >
                  <Navigation className="w-3.5 h-3.5 text-shuiro" />
                  <span>この順番でGoogleマップ経路ナビを開く</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {/* ステップタイムライン */}
          <div className="space-y-3">
            {(activePlan.steps || []).map((step, index) => {
              const matchedFav = favorites.find(
                (f) => f.spotId === step.spotId || f.name === step.spotName
              );
              const matchedSpot =
                matchedFav ||
                spots.find((s) => s.id === step.spotId) ||
                spots.find((s) => s.name === step.spotName);
              const spotKey = matchedFav?.spotId || matchedSpot?.id;
              const isVisited = spotKey ? Boolean(visitMap[spotKey]?.visited) : false;

              return (
                <div
                  key={`${step.order}-${index}`}
                  className="relative pl-7 pb-1 border-l-2 border-kin/50 last:border-l-0"
                >
                  {/* 順番バッジ */}
                  <div className="absolute -left-3.5 top-0 w-7 h-7 rounded-full bg-sumi text-kin border-2 border-kin font-serif font-black text-xs flex items-center justify-center shadow">
                    {step.order || index + 1}
                  </div>

                  <div className="rounded-xl bg-washi border border-washi-border p-3 shadow-sm space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold text-shuiro">
                        {step.travelNote}
                      </span>
                      <div className="flex items-center gap-1.5 text-[11px] text-sumi-muted">
                        {step.arrivalTime && (
                          <span className="px-1.5 py-0.2 rounded bg-kin/20 text-sumi font-mono font-bold">
                            {step.arrivalTime}〜{step.departureTime || ''}
                          </span>
                        )}
                        <span>滞在: 約{step.stayMinutes}分</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-serif font-bold text-base text-sumi flex items-center gap-1.5 flex-wrap">
                        <span>{step.spotName}</span>
                        {isVisited && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-shuiro/10 text-shuiro font-bold">
                            <CheckCircle2 className="w-3 h-3" /> 参拝済
                          </span>
                        )}
                      </h4>

                      {matchedSpot && (
                        <button
                          type="button"
                          onClick={() => handleJumpToSpot(step)}
                          className="px-2.5 py-1 rounded-lg bg-sumi text-kin text-[11px] font-serif font-bold flex items-center gap-1 shrink-0 active:scale-95"
                        >
                          <MapPin className="w-3 h-3" /> 地図で見る
                        </button>
                      )}
                    </div>

                    {step.routeReason && (
                      <p className="text-[11px] text-kin-dark font-medium bg-washi-dark/70 px-2.5 py-1 rounded-lg border border-kin/30">
                        💡 順序のポイント: {step.routeReason}
                      </p>
                    )}

                    <p className="text-xs text-sumi-muted leading-relaxed">
                      {step.highlightTip}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 参拝アドバイス */}
          {activePlan.closingAdvice && (
            <div className="rounded-xl bg-washi-dark p-3 border border-kin/40 text-xs text-sumi space-y-1">
              <p className="font-serif font-bold text-kin-dark flex items-center gap-1">
                <Compass className="w-3.5 h-3.5" /> 巡拝ワンポイントアドバイス
              </p>
              <p className="text-sumi-muted leading-relaxed">{activePlan.closingAdvice}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="jabara-card rounded-2xl p-5 text-center space-y-2">
          <p className="font-serif font-bold text-sm text-sumi">
            都道府県を選んでボタンを押すと、Gemini 4 Hydrogen がお気に入り神社を最も効率よく回れる順番を計算します
          </p>
          <p className="text-xs text-sumi-muted">
            作成したルートはスマホ内に自動保存され、ワンタップでGoogleマップの複数経由地ナビとしても開けます。
          </p>
        </div>
      )}
    </div>
  );
}
