import React, { useState } from 'react';
import {
  MapPin,
  Calendar,
  Sparkles,
  RotateCw,
  Trash2,
  ZoomIn,
  Layers,
  Award,
  Plus,
  CheckCircle2,
  X,
  Check,
  Search,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowRight
} from 'lucide-react';
import GoshuinSampleGraphic from './GoshuinSampleGraphic.jsx';
import {
  groupVisitsByCustomGroup,
  assignVisitsToGroup,
  getAllCustomGroupNames,
  reorderVisitsInGroup
} from '../db/database.js';

/**
 * 巡拝グループ（例: 生田裔神八社めぐり一宮〜八宮、七福神、霊場めぐり等）
 * ごとに御朱印をまとめて満願進捗とともに鑑賞できるビューコンポーネント
 * ★検索機能 ＆ タイトルタップでのアコーディオン開閉（折りたたみ/展開）
 * ★中の御朱印の順番入れ替え（前へ/次へ）に対応
 * ★グループの新規作成や、登録済み御朱印の後からの追加・一括割り当てに対応
 */
export default function AlbumCustomGroupView({
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
  // 折りたたみ状態マップ { [groupName]: boolean (true = 閉じている) }
  const [collapsedMap, setCollapsedMap] = useState({});

  const customGroups = groupVisitsByCustomGroup(records);
  const existingGroupNames = getAllCustomGroupNames(records);

  // 「巡拝グループ新規作成・御朱印割り当て」モーダルのステート
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalGroupName, setModalGroupName] = useState('');
  const [selectedSpotIds, setSelectedSpotIds] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  if (records.length === 0) return null;

  // 検索絞り込み
  const filteredGroups = customGroups.filter((g) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const groupNameMatch = (g.groupName || '').toLowerCase().includes(q);
    const shrineMatch = (g.records || []).some(
      (r) =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.address || '').toLowerCase().includes(q) ||
        (r.memo || '').toLowerCase().includes(q)
    );
    return groupNameMatch || shrineMatch;
  });

  // アコーディオン開閉トグル
  const handleToggleCollapse = (name) => {
    setCollapsedMap((prev) => ({
      ...prev,
      [name]: !prev[name]
    }));
  };

  // すべて展開 / すべて折りたたみ
  const handleToggleAll = (collapseAll) => {
    const nextMap = {};
    for (const g of customGroups) {
      nextMap[g.groupName] = collapseAll;
    }
    setCollapsedMap(nextMap);
  };

  // グループ内での御朱印の順番入れ替え
  const handleMoveRecord = async (e, group, currentIndex, direction) => {
    e.stopPropagation();
    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= group.records.length) return;

    const newRecords = [...group.records];
    const [movedItem] = newRecords.splice(currentIndex, 1);
    newRecords.splice(newIndex, 0, movedItem);

    const orderedIds = newRecords.map((r) => r.spotId);
    await reorderVisitsInGroup(orderedIds);
  };

  // 新規グループ作成モーダルを開く
  const handleOpenCreateModal = (presetGroupName = '') => {
    setModalGroupName(presetGroupName);
    if (presetGroupName) {
      const currentMemberIds = records
        .filter((r) => (r.groupName || '').trim() === presetGroupName)
        .map((r) => r.spotId);
      setSelectedSpotIds(currentMemberIds);
    } else {
      setSelectedSpotIds([]);
    }
    setIsModalOpen(true);
  };

  // 御朱印の選択トグル
  const handleToggleSpotSelection = (spotId) => {
    setSelectedSpotIds((prev) =>
      prev.includes(spotId) ? prev.filter((id) => id !== spotId) : [...prev, spotId]
    );
  };

  // グループへの一括割り当て保存
  const handleSaveGroupAssignment = async (e) => {
    e.preventDefault();
    const cleanGroup = modalGroupName.trim();
    if (!cleanGroup) {
      alert('グループ名を入力または選択してください。');
      return;
    }

    try {
      setIsSaving(true);
      if (selectedSpotIds.length > 0) {
        await assignVisitsToGroup(selectedSpotIds, cleanGroup);
      }
      setIsModalOpen(false);
      setModalGroupName('');
      setSelectedSpotIds([]);
    } finally {
      setIsSaving(false);
    }
  };

  // 単一の御朱印をグループから解除する処理
  const handleRemoveFromGroup = async (e, spotId) => {
    e.stopPropagation();
    const ok = window.confirm('この御朱印を巡拝グループから解除しますか？');
    if (!ok) return;
    await assignVisitsToGroup([spotId], '');
  };

  return (
    <div className="space-y-4 pb-8 animate-fade-in">
      {/* 検索バー ＆ 操作ヘッダー */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <div>
            <p className="text-xs font-serif font-bold text-sumi flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-shuiro" />
              <span>巡拝グループ鑑賞（{customGroups.length} グループ）</span>
            </p>
            <p className="text-[10px] text-sumi-muted">
              八社めぐり・七福神などをまとめて進捗鑑賞
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* 一括開閉 */}
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

            <button
              type="button"
              onClick={() => handleOpenCreateModal()}
              className="px-3 py-1.5 rounded-full bg-shuiro text-washi font-serif font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition border border-kin/40"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>グループを作成</span>
            </button>
          </div>
        </div>

        {/* ★巡拝グループ検索バー */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="グループ名・社寺名・メモで検索（例：八社、七福神、三宮...）"
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
            「{searchQuery}」に一致する巡拝グループは見つかりませんでした
          </p>
          <p className="text-xs text-sumi-muted">
            別のグループ名や社寺名でお試しください
          </p>
        </div>
      )}

      {/* グループカード一覧 */}
      {filteredGroups.map((group) => {
        const groupTitle = String(group?.groupName || group?.name || '巡拝グループ');
        const groupRecords = Array.isArray(group?.records) ? group.records : [];
        const groupCount = groupRecords.length;
        const isCollapsed = Boolean(collapsedMap[groupTitle]);

        const isUngrouped = groupTitle === 'その他の御朱印（グループ未設定）';
        const isHachisha = groupTitle.includes('生田裔神八社');
        const maxExpected = isHachisha ? 8 : (groupTitle.includes('七福神') ? 7 : null);
        const percent = maxExpected
          ? Math.min(100, Math.round((groupCount / maxExpected) * 100))
          : null;
        const isCompleted = maxExpected && groupCount >= maxExpected;

        return (
          <div
            key={groupTitle}
            className={`jabara-card gold-corner-frame rounded-3xl border-2 ${
              isCompleted
                ? 'border-kin bg-gradient-to-br from-washi via-kin/10 to-washi shadow-lg'
                : 'border-kin/40 shadow-sm'
            } transition hover:shadow-md overflow-hidden`}
          >
            {/* ★グループヘッダー（タップでアコーディオン開閉！） */}
            <div
              onClick={() => handleToggleCollapse(groupTitle)}
              className="p-4 cursor-pointer select-none flex items-start justify-between gap-2 hover:bg-kin/10 transition"
              title="タップして展開・折りたたみ"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-serif font-black ${
                      isCompleted
                        ? 'bg-shuiro text-washi shadow-sm animate-pulse'
                        : isUngrouped
                        ? 'bg-washi-dark text-sumi-muted border border-washi-border'
                        : 'bg-kin text-sumi shadow-sm'
                    }`}
                  >
                    {isCompleted
                      ? '㊗️ 満願達成！'
                      : isUngrouped
                      ? '未分類'
                      : `巡拝集印 ${groupCount} 社寺`}
                  </span>
                  {maxExpected && (
                    <span className="text-[10px] font-serif font-bold text-sumi">
                      （{groupCount} / {maxExpected} 社寺 達成）
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1.5">
                  <h3 className="font-serif font-black text-base text-sumi truncate">
                    {groupTitle}
                  </h3>
                  <span className="text-[10px] text-sumi-muted/70 font-serif">
                    {isCollapsed ? '（タップで開く ▼）' : '（タップで閉じる ▲）'}
                  </span>
                </div>

                {isHachisha && (
                  <p className="text-[11px] text-sumi-muted mt-0.5 font-serif">
                    生田神社の裔神八社（一宮〜八宮）を巡る、神戸・三宮の伝統的な巡拝コースです。
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end gap-1.5 shrink-0 self-stretch justify-between">
                <div className="flex items-center gap-2">
                  {percent !== null && (
                    <div className="text-right">
                      <span className="text-base font-serif font-black text-shuiro leading-none block">
                        {percent}%
                      </span>
                      <span className="text-[8px] text-sumi-muted block font-serif">進捗</span>
                    </div>
                  )}

                  <div className="w-7 h-7 rounded-full bg-washi border border-kin/40 flex items-center justify-center text-sumi shadow-sm">
                    {isCollapsed ? (
                      <ChevronDown className="w-4 h-4 text-shuiro" />
                    ) : (
                      <ChevronUp className="w-4 h-4 text-shuiro" />
                    )}
                  </div>
                </div>

                {!isUngrouped && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenCreateModal(groupTitle);
                    }}
                    className="px-2 py-0.5 rounded-lg bg-washi hover:bg-kin/20 text-sumi text-[10px] font-serif font-bold border border-kin/40 flex items-center gap-1 active:scale-95 transition mt-1"
                    title="このグループに登録済みの御朱印を追加・編集"
                  >
                    <Plus className="w-3 h-3 text-shuiro" />
                    <span>御朱印を追加</span>
                  </button>
                )}
              </div>
            </div>

            {/* 進捗プログレスバー（満願目安がある場合・ヘッダー直下） */}
            {percent !== null && (
              <div className="px-4 pb-2">
                <div className="w-full bg-washi-dark/80 h-2 rounded-full overflow-hidden border border-kin/40">
                  <div
                    className="bg-gradient-to-r from-kin to-shuiro h-full transition-all duration-700"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            )}

            {/* ★アコーディオン展開部（御朱印グリッド＆並び替え） */}
            {!isCollapsed && (
              <div className="p-4 pt-2 border-t border-kin/20 space-y-3 animate-fade-in">
                {groupCount > 1 && (
                  <p className="text-[10px] text-sumi-muted font-serif flex items-center gap-1">
                    <span>💡 各御朱印の「◀ / ▶」ボタンで巡拝の順番（一宮〜八宮など）を入れ替えられます</span>
                  </p>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {groupRecords.map((record, idx) => {
                    const isShrine = record.type === 'shrine';
                    const isWide = Boolean(wideSpotMap[record.spotId]);
                    const firstSample = record.sampleGoshuin?.[0] || {
                      calligraphy: (record.name || '').slice(0, 4),
                      subText: record.visitedDate || '奉拝',
                      stampText: `${(record.name || '').slice(0, 3)}印`
                    };

                    const isFirst = idx === 0;
                    const isLast = idx === groupRecords.length - 1;

                    return (
                      <div
                        key={record.spotId}
                        onClick={() => onCardClick(record)}
                        className="rounded-2xl p-2.5 bg-washi border border-kin/35 flex flex-col justify-between cursor-pointer hover:border-shuiro/60 hover:shadow transition active:scale-[0.98]"
                      >
                        {/* 上部タグ ＆ 並び替えボタン */}
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-bold text-washi ${
                                isShrine ? 'bg-shuiro' : 'bg-tera'
                              }`}
                            >
                              {isShrine ? '神社' : '寺院'}
                            </span>
                            {/* ★順番入れ替えボタン（◀ / ▶） */}
                            {groupCount > 1 && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-0.5 ml-0.5"
                              >
                                <button
                                  type="button"
                                  disabled={isFirst}
                                  onClick={(e) => handleMoveRecord(e, group, idx, -1)}
                                  className="w-5 h-5 rounded bg-washi-dark hover:bg-kin/30 disabled:opacity-30 disabled:hover:bg-washi-dark text-sumi border border-kin/30 flex items-center justify-center transition"
                                  title="前へ移動"
                                >
                                  <ArrowLeft className="w-2.5 h-2.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isLast}
                                  onClick={(e) => handleMoveRecord(e, group, idx, 1)}
                                  className="w-5 h-5 rounded bg-washi-dark hover:bg-kin/30 disabled:opacity-30 disabled:hover:bg-washi-dark text-sumi border border-kin/30 flex items-center justify-center transition"
                                  title="次へ移動"
                                >
                                  <ArrowRight className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            {record.photoDataUrl && (
                              <button
                                type="button"
                                onClick={(e) => onQuickRotate(e, record)}
                                disabled={rotatingSpotId === record.spotId}
                                className="p-1 rounded-full bg-washi-dark hover:bg-kin/20 text-sumi border border-kin/40"
                                title="写真を90°回転"
                              >
                                <RotateCw
                                  className={`w-2.5 h-2.5 text-shuiro ${
                                    rotatingSpotId === record.spotId ? 'animate-spin' : ''
                                  }`}
                                />
                              </button>
                            )}
                            {!isUngrouped && (
                              <button
                                type="button"
                                onClick={(e) => handleRemoveFromGroup(e, record.spotId)}
                                className="p-1 rounded-full bg-washi-dark hover:bg-shuiro/20 text-sumi-muted hover:text-shuiro border border-washi-border"
                                title="このグループから外す"
                              >
                                <X className="w-2.5 h-2.5" />
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

                        {/* 御朱印写真 */}
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

                        {/* 社寺名・日付 */}
                        <div className="space-y-1">
                          <h4 className="font-serif font-bold text-xs text-sumi truncate">
                            {record.name}
                          </h4>
                          <p className="text-[10px] text-sumi-muted flex items-center gap-1 truncate">
                            <Calendar className="w-2.5 h-2.5 text-shuiro shrink-0" />
                            <span>{record.visitedDate || '拝受済'}</span>
                          </p>

                          {/* 未設定グループの場合のグループ設定ボタン */}
                          {isUngrouped && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="pt-1 border-t border-washi-border"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSpotIds([record.spotId]);
                                  setModalGroupName('生田裔神八社めぐり（一宮〜八宮）');
                                  setIsModalOpen(true);
                                }}
                                className="w-full py-1 rounded bg-kin/20 hover:bg-kin/30 text-sumi text-[9px] font-serif font-bold flex items-center justify-center gap-0.5"
                              >
                                <Plus className="w-2.5 h-2.5" />
                                巡拝グループに設定
                              </button>
                            </div>
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

      {/* ★巡拝グループ新規作成 ＆ 登録済み御朱印の後から登録モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-sumi/75 backdrop-blur-sm p-0 sm:p-4">
          <div className="absolute inset-0" onClick={() => setIsModalOpen(false)} />

          <div className="relative z-10 w-full max-w-[440px] max-h-[90vh] washi-pattern rounded-t-3xl sm:rounded-3xl border-t-2 sm:border-2 border-kin shadow-2xl flex flex-col animate-slide-up overflow-hidden">
            {/* ヘッダー */}
            <div className="bg-sumi text-washi px-5 py-3.5 border-b border-kin/40 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-shuiro border border-kin flex items-center justify-center font-serif font-black text-xs text-washi">
                  巡
                </div>
                <div>
                  <h3 className="font-serif font-black text-sm text-kin">
                    巡拝グループの設定・御朱印登録
                  </h3>
                  <p className="text-[10px] text-washi/70">
                    登録済みの御朱印をグループにまとめて鑑賞
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-washi/80 hover:text-washi transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* フォーム */}
            <form onSubmit={handleSaveGroupAssignment} className="flex-1 overflow-y-auto p-4 space-y-4 text-sumi">
              {/* グループ名入力 ＆ 登録済みグループの候補チップ */}
              <div className="space-y-1.5">
                <label className="font-serif font-bold text-xs flex items-center gap-1.5 text-sumi">
                  <Award className="w-3.5 h-3.5 text-shuiro" />
                  巡拝グループ名 <span className="text-[10px] text-shuiro">※必須</span>
                </label>
                <input
                  type="text"
                  value={modalGroupName}
                  onChange={(e) => setModalGroupName(e.target.value)}
                  placeholder="例：生田裔神八社めぐり（一宮〜八宮）、七福神めぐり など"
                  className="w-full rounded-xl border border-washi-border bg-washi px-3.5 py-2 text-xs font-serif font-bold text-sumi focus:outline-none focus:border-kin"
                  required
                />

                {/* 候補チップ */}
                <div className="space-y-1 pt-1">
                  <p className="text-[10px] text-sumi-muted font-serif">
                    ※タップすると候補が自動入力されます：
                  </p>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-0.5">
                    {existingGroupNames.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setModalGroupName(g)}
                        className={`text-[10px] px-2 py-0.5 rounded-lg border transition ${
                          modalGroupName === g
                            ? 'bg-shuiro text-washi border-shuiro font-bold'
                            : 'bg-washi border-kin/30 text-sumi-muted hover:text-sumi hover:border-shuiro/50'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 登録済みの御朱印を選択するリスト */}
              <div className="space-y-2 pt-2 border-t border-washi-border">
                <div className="flex items-center justify-between">
                  <label className="font-serif font-bold text-xs flex items-center gap-1.5 text-sumi">
                    <Layers className="w-3.5 h-3.5 text-kin-dark" />
                    このグループに登録する御朱印を選ぶ（{selectedSpotIds.length} 選択中）
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedSpotIds.length === records.length) {
                        setSelectedSpotIds([]);
                      } else {
                        setSelectedSpotIds(records.map((r) => r.spotId));
                      }
                    }}
                    className="text-[10px] font-serif text-shuiro font-bold underline"
                  >
                    {selectedSpotIds.length === records.length ? '全解除' : '全選択'}
                  </button>
                </div>

                <div className="max-h-60 overflow-y-auto space-y-1.5 pr-0.5">
                  {records.map((r) => {
                    const isSelected = selectedSpotIds.includes(r.spotId);
                    const currentGroup = (r.groupName || '').trim();

                    return (
                      <div
                        key={r.spotId}
                        onClick={() => handleToggleSpotSelection(r.spotId)}
                        className={`p-2 rounded-xl border flex items-center gap-2.5 cursor-pointer transition ${
                          isSelected
                            ? 'bg-shuiro/10 border-shuiro ring-1 ring-shuiro'
                            : 'bg-washi border-kin/25 hover:border-kin'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="w-4 h-4 text-shuiro rounded border-kin focus:ring-0 cursor-pointer"
                        />

                        {/* 小さいサムネイル */}
                        <div className="w-10 h-10 rounded-lg bg-washi-dark border border-kin/30 overflow-hidden flex items-center justify-center shrink-0">
                          {r.photoDataUrl ? (
                            <img
                              src={r.photoDataUrl}
                              alt={r.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-[9px] font-serif text-shuiro font-bold">
                              {r.type === 'shrine' ? '神社' : '寺院'}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="font-serif font-bold text-xs text-sumi truncate">
                            {r.name}
                          </p>
                          <p className="text-[10px] text-sumi-muted flex items-center gap-2">
                            <span>{r.visitedDate || '拝受済'}</span>
                            {currentGroup && (
                              <span className="text-[9px] bg-kin/20 text-sumi px-1.5 py-0.2 rounded truncate max-w-[120px]">
                                {currentGroup}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 保存ボタン */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSaving || !modalGroupName.trim()}
                  className="w-full py-3 rounded-2xl bg-shuiro text-washi font-serif font-bold text-xs shadow-md border border-kin/40 flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-60"
                >
                  <Check className="w-4 h-4 text-kin" />
                  <span>
                    選択した {selectedSpotIds.length} 件を「{modalGroupName || 'グループ'}」に登録
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
