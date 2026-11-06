import React, { useState } from 'react';
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
  ArrowRight
} from 'lucide-react';
import { generateAiPilgrimageRoute, getGeminiApiKey } from '../services/geminiService.js';
import { db } from '../db/database.js';
import { useLiveQuery } from 'dexie-react-hooks';

/**
 * 現在地周辺の神社・お寺リストから、移動手段や所要時間に合わせて
 * Gemini AIが最適な「御朱印めぐりモデルコース」を自動作成する画面コンポーネント
 */
export default function AiConciergeView({
  userLocation,
  spots,
  visitMap,
  onSelectSpotOnMap,
  onOpenAiSettings
}) {
  const [transportMode, setTransportMode] = useState('walk_train');
  const [durationHours, setDurationHours] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [currentRoute, setCurrentRoute] = useState(null);

  // 過去に生成したAIルート履歴をIndexedDBから取得
  const savedRoutes = useLiveQuery(
    () => db.aiRoutes.orderBy('createdAt').reverse().limit(5).toArray(),
    [],
    []
  );

  const handleGenerateCourse = async () => {
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

      // オフラインでも外で見返せるようIndexedDBに自動保存
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
    const matched =
      spots.find((s) => s.id === step.spotId) ||
      spots.find((s) => s.name === step.spotName);
    if (matched) {
      onSelectSpotOnMap(matched);
    }
  };

  const activePlan = currentRoute || savedRoutes?.[0]?.plan || null;

  return (
    <div className="w-full h-full overflow-y-auto washi-pattern px-4 py-4 space-y-5">
      {/* ヘッダーカード */}
      <div className="rounded-2xl bg-sumi text-washi p-4 border-2 border-kin/60 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-kin/20 border border-kin flex items-center justify-center text-kin">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-base text-washi">
                AI御朱印めぐりコンシェルジュ
              </h2>
              <p className="text-[11px] text-kin">
                現在地周辺の{spots.length}社寺から最適ルートを自動設計
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

        {/* 移動手段の選択 */}
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

        {/* 所要時間の選択 */}
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

        {/* 生成実行ボタン */}
        <button
          type="button"
          disabled={isGenerating}
          onClick={handleGenerateCourse}
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

      {/* 生成されたコースの表示 */}
      {activePlan ? (
        <div className="jabara-card rounded-2xl p-4 space-y-4 pb-6">
          <div className="border-b border-washi-border pb-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="px-2 py-0.5 rounded bg-shuiro/15 text-shuiro font-serif font-bold text-[10px]">
                AIご提案モデルコース
              </span>
              <span className="text-xs font-bold text-kin-dark flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {activePlan.totalEstimatedTime}
              </span>
            </div>
            <h3 className="font-serif font-black text-lg text-sumi leading-snug">
              {activePlan.courseTitle}
            </h3>
            <p className="text-xs text-sumi-muted mt-1 leading-relaxed">
              {activePlan.concept}
            </p>
          </div>

          {/* ステップタイムライン */}
          <div className="space-y-3">
            {(activePlan.steps || []).map((step, index) => {
              const matchedSpot =
                spots.find((s) => s.id === step.spotId) ||
                spots.find((s) => s.name === step.spotName);
              const isVisited = matchedSpot ? Boolean(visitMap[matchedSpot.id]?.visited) : false;

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
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-shuiro">
                        {step.travelNote}
                      </span>
                      <span className="text-[11px] text-sumi-muted">
                        滞在目安: 約{step.stayMinutes}分
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-serif font-bold text-base text-sumi flex items-center gap-1.5">
                        {step.spotName}
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
        <div className="jabara-card rounded-2xl p-6 text-center space-y-2">
          <p className="font-serif font-bold text-sm text-sumi">
            上のボタンを押すと、現在地周辺の寺社を結ぶ最適な御朱印めぐりコースをAIが提案します
          </p>
          <p className="text-xs text-sumi-muted">
            作成したコースはスマホ内に自動保存されるため、移動中に電波が弱くなっても安心です。
          </p>
        </div>
      )}
    </div>
  );
}
