import React, { useState } from 'react';
import {
  MapPin,
  Calendar,
  Sparkles,
  RotateCw,
  Trash2,
  ZoomIn,
  Layers,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowRight,
  ChevronsUpDown
} from 'lucide-react';
import GoshuinSampleGraphic from './GoshuinSampleGraphic.jsx';
import { groupVisitsByPlace, reorderVisitsInPlace } from '../db/database.js';

/**
 * 同じ神社・お寺で拝受した複数の御朱印を自動でグループ化して
 * 社寺ごとにまとめて鑑賞できるビューコンポーネント
 * ★検索機能 ＆ タイトルタップでのアコーディオン開閉（折りたたみ/展開）
 * ★中の御朱印の順番入れ替え（前へ/次へ）に対応
 */
export default function AlbumPlaceGroupView({
  records = [],
  allSpots = [],
  wideSpotMap = {},
  rotatingSpotId = null,
  onCardClick,
  onQuickRotate,
  onDeleteRecord,
  onOpenLightbox
}) {
  const [searchQuery, setSearchQuery] = useState('');
  // 折りたたみ状態マップ { [placeKey]: boolean (true = 閉じている) }
  const [collapsedMap, setCollapsedMap] = useState({});

  const allGroups = groupVisitsByPlace(records);

  // 社寺名または住所での検索絞り込み
  const filteredGroups = allGroups.filter((g) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const nameMatch = (g.name || '').toLowerCase().includes(q);
    const addrMatch = (g.address || '').toLowerCase().includes(q);
    const memoMatch = g.records.some((r) => (r.memo || '').toLowerCase().includes(q));
    return nameMatch || addrMatch || memoMatch;
  });

  if (allGroups.length === 0) {
    return null;
  }

  // 複数枚集めた社寺の数
  const multiGoshuinPlacesCount = allGroups.filter((g) => g.count > 1).length;

  // アコーディオン開閉トグル
  const handleToggleCollapse = (key) => {
    setCollapsedMap((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // すべて展開 / すべて折りたたみ
  const handleToggleAll = (collapseAll) => {
    const nextMap = {};
    for (const g of allGroups) {
      nextMap[g.placeId || g.key] = collapseAll;
    }
    setCollapsedMap(nextMap);
  };

  // 御朱印の順番を前後に移動する
  const handleMoveRecord = async (e, group, currentIndex, direction) => {
    e.stopPropagation();
    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= group.records.length) return;

    const newRecords = [...group.records];
    const [movedItem] = newRecords.splice(currentIndex, 1);
    newRecords.splice(newIndex, 0, movedItem);

    const orderedIds = newRecords.map((r) => r.spotId);
    await reorderVisitsInPlace(orderedIds);
  };

  return (
    <div className="space-y-4 pb-8 animate-fade-in">
      {/* 検索バー ＆ 集計ヘッダー */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-xs font-serif font-bold text-sumi flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-shuiro" />
              <span>社寺別まとめ鑑賞（{allGroups.length} 社寺・全{records.length}枚）</span>
            </p>
            {multiGoshuinPlacesCount > 0 && (
              <p className="text-[10px] text-kin-dark font-serif font-bold">
                ✨ 2枚以上拝受した社寺: {multiGoshuinPlacesCount} ヶ所
              </p>
            )}
          </div>

          {/* 一括開閉ボタン */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleToggleAll(false)}
              className="text-[10px] px-2 py-0.5 rounded-lg bg-washi border border-kin/30 text-sumi-muted hover:text-sumi font-serif"
            >
              全展開
            </button>
            <button
              type="button"
              onClick={() => handleToggleAll(true)}
              className="text-[10px] px-2 py-0.5 rounded-lg bg-washi border border-kin/30 text-sumi-muted hover:text-sumi font-serif"
            >
              全折畳
            </button>
          </div>
        </div>

        {/* 社寺名リアルタイム検索バー */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="神社・お寺の名前や住所で検索（例：生田、湊川、神戸市...）"
            className="w-full rounded-2xl border border-kin/40 bg-washi pl-9 pr-8 py-2 text-xs font-serif text-sumi focus:outline-none focus:border-shuiro shadow-sm"
          />
          <Search className="w-4 h-4 text-kin-dark absolute left-3 top-1/2 -translate-y-1/2" />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-sumi-muted hover:text-sumi"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 検索結果が0件のとき */}
      {filteredGroups.length === 0 && (
        <div className="p-8 text-center bg-washi/80 rounded-2xl border border-washi-border space-y-1.5">
          <p className="font-serif font-bold text-sm text-sumi">
            「{searchQuery}」に一致する社寺は見つかりませんでした
          </p>
          <p className="text-xs text-sumi-muted">
            別の神社名やキーワードでお試しください
          </p>
        </div>
      )}

      {/* 社寺カード一覧 */}
      {filteredGroups.map((group) => {
        const groupKey = group.placeId || group.key;
        const isCollapsed = Boolean(collapsedMap[groupKey]);
        const isShrine = group.type === 'shrine';
        const hasMultiple = group.count > 1;

        return (
          <div
            key={groupKey}
            className={`jabara-card gold-corner-frame rounded-3xl border-2 ${
              hasMultiple ? 'border-kin/60 bg-gradient-to-br from-washi via-kin/5 to-washi' : 'border-kin/35'
            } shadow-sm transition hover:shadow-md overflow-hidden`}
          >
            {/* ★社寺ヘッダー（タップでアコーディオン開閉！） */}
            <div
              onClick={() => handleToggleCollapse(groupKey)}
              className="p-4 cursor-pointer select-none flex items-start justify-between gap-2 hover:bg-kin/10 transition"
              title="タップして展開・折りたたみ"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-serif font-bold text-washi ${
                      isShrine ? 'bg-shuiro' : 'bg-tera'
                    }`}
                  >
                    {isShrine ? '⛩️ 神社' : '☸️ 寺院'}
                  </span>

                  {/* 拝受枚数バッジ */}
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-serif font-black flex items-center gap-1 ${
                      hasMultiple
                        ? 'bg-gradient-to-r from-kin-light via-kin to-kin-dark text-sumi shadow-sm ring-1 ring-kin'
                        : 'bg-washi-dark text-sumi border border-kin/30'
                    }`}
                  >
                    <Sparkles className="w-3 h-3 text-shuiro" />
                    <span>拝受 {group.count} 枚</span>
                  </span>

                  {group.denomination && (
                    <span className="text-[10px] text-sumi-muted font-serif">
                      {group.denomination}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1.5">
                  <h3 className="font-serif font-black text-base text-sumi truncate">
                    {group.name}
                  </h3>
                  <span className="text-[10px] text-sumi-muted/70 font-serif">
                    {isCollapsed ? '（タップで開く ▼）' : '（タップで閉じる ▲）'}
                  </span>
                </div>

                {group.address && (
                  <p className="text-[11px] text-sumi-muted mt-0.5 flex items-center gap-1 truncate">
                    <MapPin className="w-3 h-3 text-shuiro shrink-0" />
                    <span>{group.address}</span>
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end justify-between self-stretch shrink-0">
                <div className="w-7 h-7 rounded-full bg-washi border border-kin/40 flex items-center justify-center text-sumi shadow-sm">
                  {isCollapsed ? (
                    <ChevronDown className="w-4 h-4 text-shuiro" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-shuiro" />
                  )}
                </div>

                {group.latestDate && (
                  <span className="text-[10px] font-serif font-bold text-sumi flex items-center gap-0.5 mt-2">
                    <Calendar className="w-3 h-3 text-shuiro" />
                    {group.latestDate}
                  </span>
                )}
              </div>
            </div>

            {/* ★アコーディオン展開部（御朱印グリッド＆並び替え） */}
            {!isCollapsed && (
              <div className="p-4 pt-1 border-t border-kin/20 space-y-3 animate-fade-in">
                {hasMultiple && (
                  <p className="text-[10px] text-sumi-muted font-serif flex items-center gap-1">
                    <span>💡 各御朱印の「◀ / ▶」ボタンで拝受した順番を入れ替えられます</span>
                  </p>
                )}

                <div
                  className={`grid ${
                    hasMultiple ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1'
                  } gap-2.5`}
                >
                  {group.records.map((record, idx) => {
                    const isWide = Boolean(wideSpotMap[record.spotId]);
                    const firstSample = record.sampleGoshuin?.[0] || {
                      calligraphy: (record.name || '').slice(0, 4),
                      subText: record.visitedDate || '奉拝',
                      stampText: `${(record.name || '').slice(0, 3)}印`
                    };

                    const isFirst = idx === 0;
                    const isLast = idx === group.records.length - 1;

                    return (
                      <div
                        key={record.spotId}
                        onClick={() => onCardClick(record)}
                        className="rounded-2xl p-2.5 bg-washi border border-kin/35 flex flex-col justify-between cursor-pointer hover:border-shuiro/60 hover:shadow transition active:scale-[0.98]"
                      >
                        {/* 上部タグ ＆ 並び替え矢印ボタン */}
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-serif font-bold text-kin-dark">
                              #{idx + 1}
                            </span>
                            {/* ★順番入れ替えボタン（◀ / ▶） */}
                            {hasMultiple && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-0.5 ml-0.5"
                              >
                                <button
                                  type="button"
                                  disabled={isFirst}
                                  onClick={(e) => handleMoveRecord(e, group, idx, -1)}
                                  className="w-5 h-5 rounded bg-washi-dark hover:bg-kin/30 disabled:opacity-30 disabled:hover:bg-washi-dark text-sumi border border-kin/30 flex items-center justify-center transition"
                                  title="前（左）へ移動"
                                >
                                  <ArrowLeft className="w-2.5 h-2.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isLast}
                                  onClick={(e) => handleMoveRecord(e, group, idx, 1)}
                                  className="w-5 h-5 rounded bg-washi-dark hover:bg-kin/30 disabled:opacity-30 disabled:hover:bg-washi-dark text-sumi border border-kin/30 flex items-center justify-center transition"
                                  title="次（右）へ移動"
                                >
                                  <ArrowRight className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            {isWide && record.photoDataUrl && (
                              <span className="px-1.5 py-0.2 rounded-full bg-kin text-sumi font-serif font-bold text-[9px]">
                                見開き
                              </span>
                            )}
                            {record.photoDataUrl && (
                              <button
                                type="button"
                                onClick={(e) => onQuickRotate(e, record)}
                                disabled={rotatingSpotId === record.spotId}
                                className="p-1 rounded-full bg-washi-dark hover:bg-kin/20 text-sumi border border-kin/40"
                                title="写真を90°回転（横向きにする）"
                              >
                                <RotateCw
                                  className={`w-2.5 h-2.5 text-shuiro ${
                                    rotatingSpotId === record.spotId ? 'animate-spin' : ''
                                  }`}
                                />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => onDeleteRecord(e, record)}
                              className="p-1 rounded-full bg-shuiro/10 hover:bg-shuiro/20 text-shuiro border border-shuiro/30"
                              title="この御朱印記録を削除"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>

                        {/* 御朱印画像 */}
                        <div
                          onClick={(e) => {
                            if (record.photoDataUrl) {
                              e.stopPropagation();
                              onOpenLightbox(record);
                            }
                          }}
                          className="relative w-full aspect-[3/4] rounded-xl overflow-hidden bg-washi-dark border border-kin/30 flex items-center justify-center mb-2 shadow-inner group"
                        >
                          {record.photoDataUrl ? (
                            <>
                              <img
                                src={record.photoDataUrl}
                                alt={record.name}
                                className="w-full h-full object-contain"
                              />
                              <div className="absolute bottom-1 right-1 bg-sumi/80 text-kin px-1.5 py-0.5 rounded-full flex items-center gap-0.5 text-[8px] font-serif font-bold opacity-80 group-hover:opacity-100">
                                <ZoomIn className="w-2.5 h-2.5" />
                                <span>拡大</span>
                              </div>
                            </>
                          ) : (
                            <div className="scale-90">
                              <GoshuinSampleGraphic
                                sample={firstSample}
                                spotType={record.type}
                                compact
                              />
                            </div>
                          )}
                        </div>

                        {/* 日付・メモ */}
                        <div className="space-y-0.5">
                          <p className="text-[10px] font-serif font-bold text-sumi flex items-center gap-1">
                            <Calendar className="w-2.5 h-2.5 text-shuiro shrink-0" />
                            <span>{record.visitedDate || '拝受済'}</span>
                          </p>
                          {record.memo ? (
                            <p className="text-[10px] text-sumi-muted bg-washi-dark/80 px-2 py-0.5 rounded border border-washi-border line-clamp-1 font-serif">
                              「{record.memo}」
                            </p>
                          ) : (
                            <p className="text-[9px] text-sumi-muted/70 italic">
                              タップして詳細・メモ
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
