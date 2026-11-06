import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  X,
  BookOpen,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Calendar,
  MapPin,
  Edit3,
  Layers,
  Wand2,
  ZoomIn
} from 'lucide-react';
import GoshuinSampleGraphic from './GoshuinSampleGraphic.jsx';
import GoshuinPhotoLightbox from './GoshuinPhotoLightbox.jsx';

/**
 * 表紙をタップした時に起動する2大特別鑑賞モード：
 * ① 『3D表紙オープン＆リアルページめくりモード』（立体的な表紙がパカッと開いて1ページずつペラペラめくれる）
 * ② 『天空の御朱印ウォール』（漆黒と金箔の空間に、集めた御朱印が奥から手前へ「ぶわーっ！」と一斉に飛び出して宙に浮かぶ）
 */
export default function GoshuinShowcaseModal({
  isOpen,
  initialMode = 'book3d', // 'book3d' | 'skywall'
  onClose,
  visitedList,
  currentTheme,
  bookTitle,
  onSelectRecordDetail
}) {
  const [mode, setMode] = useState(initialMode);
  const [isOpeningCover, setIsOpeningCover] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const [flipDirection, setFlipDirection] = useState('next'); // 'next' | 'prev'
  const [focusedSkyRecord, setFocusedSkyRecord] = useState(null);
  const [lightboxRecord, setLightboxRecord] = useState(null);
  const [wideSpotMap, setWideSpotMap] = useState({});
  const [burstKey, setBurstKey] = useState(0);

  // スワイプ検知用座標
  const touchStartX = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setPageIndex(0);
      setFocusedSkyRecord(null);
      setBurstKey((k) => k + 1);

      // 起動時に金箔と桜色の紙吹雪をふわっと舞わせる
      confetti({
        particleCount: 40,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#c5a059', '#e88b9c', '#fcfaf2', '#c93a40']
      });

      if (initialMode === 'book3d') {
        setIsOpeningCover(true);
        const timer = setTimeout(() => {
          setIsOpeningCover(false);
        }, 700);
        return () => clearTimeout(timer);
      } else {
        setIsOpeningCover(false);
      }
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const totalPages = visitedList.length;
  const currentRecord = visitedList[pageIndex] || null;
  const isCurrentWide = currentRecord
    ? Boolean(wideSpotMap[currentRecord.spotId])
    : false;

  const handleImageLoaded = (spotId, e) => {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      const isWide = img.naturalWidth > img.naturalHeight * 1.02;
      setWideSpotMap((prev) =>
        prev[spotId] === isWide ? prev : { ...prev, [spotId]: isWide }
      );
    }
  };

  // 次のページへめくる
  const handleNextPage = () => {
    if (pageIndex < totalPages - 1) {
      setFlipDirection('next');
      setPageIndex((p) => p + 1);
    }
  };

  // 前のページへめくる
  const handlePrevPage = () => {
    if (pageIndex > 0) {
      setFlipDirection('prev');
      setPageIndex((p) => p - 1);
    }
  };

  // 指での左右スワイプ操作
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches?.[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const endX = e.changedTouches?.[0]?.clientX ?? touchStartX.current;
    const diffX = endX - touchStartX.current;
    if (diffX < -42) {
      handleNextPage();
    } else if (diffX > 42) {
      handlePrevPage();
    }
    touchStartX.current = null;
  };

  // モード切替時の演出
  const handleSwitchMode = (nextMode) => {
    setMode(nextMode);
    setFocusedSkyRecord(null);
    if (nextMode === 'skywall') {
      setBurstKey((k) => k + 1);
      confetti({
        particleCount: 55,
        spread: 100,
        origin: { y: 0.55 },
        colors: ['#c5a059', '#fcfaf2', '#c93a40']
      });
    } else {
      setIsOpeningCover(true);
      setTimeout(() => setIsOpeningCover(false), 680);
    }
  };

  return (
    <div className="fixed inset-0 z-50 sky-cosmos-bg flex flex-col justify-between overflow-hidden select-none">
      {/* 背景に舞う金箔パーティクル装飾 */}
      <div className="absolute inset-0 pointer-events-none opacity-35">
        <div className="w-full h-full bg-[radial-gradient(#c5a059_1px,transparent_1px)] [background-size:28px_28px]" />
      </div>

      {/* 上部バー：モード切替（3Dページめくり ⇔ 天空ウォール）＆閉じる */}
      <div className="relative z-20 px-4 pt-4 pb-2 flex items-center justify-between gap-2 max-w-[430px] w-full mx-auto">
        <div className="flex items-center bg-white/10 backdrop-blur-md p-1 rounded-full border border-kin/40 shadow-lg">
          <button
            type="button"
            onClick={() => handleSwitchMode('book3d')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-serif font-bold flex items-center gap-1.5 transition ${
              mode === 'book3d'
                ? 'bg-kin text-sumi shadow-md'
                : 'text-washi/80 hover:text-washi'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>3Dページめくり</span>
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode('skywall')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-serif font-bold flex items-center gap-1.5 transition ${
              mode === 'skywall'
                ? 'bg-shuiro text-washi shadow-md border border-kin/50'
                : 'text-washi/80 hover:text-washi'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-kin" />
            <span>天空ウォール展開</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/15 text-washi border border-white/25 flex items-center justify-center hover:bg-white/25 active:scale-95 transition"
          aria-label="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ==================== モードA: 3D表紙オープン＆リアルページめくり ==================== */}
      {mode === 'book3d' && (
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="relative z-10 flex-1 flex flex-col items-center justify-center px-5 py-2 max-w-[430px] w-full mx-auto book-perspective"
        >
          {/* 3Dでパカッと開く表紙アニメーションオーバーレイ */}
          {isOpeningCover && (
            <div
              className={`absolute inset-x-7 h-[460px] rounded-r-3xl rounded-l-lg ${currentTheme.coverBg} border-2 ${currentTheme.accentBorder} shadow-2xl z-30 flex items-center justify-center animate-cover-open pointer-events-none`}
            >
              {/* 背表紙の金ライン */}
              <div className="absolute left-3 top-0 bottom-0 w-1 bg-kin/50" />
              {/* 縦書き題箋 */}
              <div className="bg-washi text-sumi px-5 py-6 rounded-xl border-2 border-kin shadow-2xl flex flex-col items-center">
                <span className="text-[10px] font-serif text-shuiro font-bold tracking-widest border-b border-shuiro/40 pb-1 mb-2">
                  奉拝御朱印帳
                </span>
                <span className="font-serif font-black text-2xl text-sumi writing-vertical tracking-widest">
                  {bookTitle}
                </span>
              </div>
            </div>
          )}

          {/* 開かれた御朱印帳の本紙ページ */}
          {currentRecord && (
            <div
              key={`${currentRecord.spotId}-${pageIndex}`}
              className={`w-full max-w-[365px] jabara-fold-left gold-corner-frame rounded-3xl p-5 border-2 border-kin shadow-[0_20px_50px_rgba(0,0,0,0.65)] flex flex-col justify-between min-h-[470px] max-h-[74vh] ${
                flipDirection === 'next' ? 'animate-page-next' : 'animate-page-prev'
              }`}
            >
              {/* ページ上部：何頁目・日付 */}
              <div className="flex items-center justify-between border-b border-kin/40 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-sumi text-kin font-serif font-bold text-xs">
                    第 {pageIndex + 1} 頁 / 全 {totalPages} 頁
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold text-washi ${
                      currentRecord.type === 'shrine' ? 'bg-shuiro' : 'bg-tera'
                    }`}
                  >
                    {currentRecord.type === 'shrine' ? '⛩️ 神社' : '☸️ 寺院'}
                  </span>
                </div>
                <span className="text-xs font-serif font-bold text-sumi-muted flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-shuiro" />
                  {currentRecord.visitedDate || '記録済'}
                </span>
              </div>

              {/* ページ中央：見開き（横長）御朱印の場合は横幅いっぱいに全体像を表示、通常御朱印は右側に縦書き銘板 */}
              {isCurrentWide && currentRecord.photoDataUrl ? (
                <div className="flex-1 my-3 flex flex-col justify-center gap-2.5 overflow-hidden">
                  <div
                    onClick={() => setLightboxRecord(currentRecord)}
                    className="relative w-full rounded-2xl overflow-hidden bg-washi-dark border-2 border-kin/70 shadow-inner flex items-center justify-center p-1.5 cursor-zoom-in"
                  >
                    <img
                      src={currentRecord.photoDataUrl}
                      alt={currentRecord.name}
                      onLoad={(e) => handleImageLoaded(currentRecord.spotId, e)}
                      className="w-full max-h-[245px] object-contain rounded-xl"
                    />
                    <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-washi/95 border-2 border-shuiro text-shuiro font-serif font-black text-xs rotate-[-6deg] shadow">
                      見開き奉拝
                    </div>
                    <div className="absolute bottom-2 right-2 px-2.5 py-0.5 rounded-full bg-sumi/85 text-kin border border-kin/50 text-[10px] font-serif font-bold flex items-center gap-1 shadow">
                      <ZoomIn className="w-3 h-3" />
                      <span>タップで拡大</span>
                    </div>
                  </div>

                  <div className="py-1.5 px-3 rounded-xl bg-washi-dark/80 border border-kin/40 flex items-center justify-between">
                    <span className="text-[10px] font-serif text-kin-dark font-bold">
                      📖 見開き御朱印
                    </span>
                    <h3 className="font-serif font-black text-base text-sumi truncate">
                      {currentRecord.name}
                    </h3>
                  </div>
                </div>
              ) : (
                <div className="flex-1 my-3 flex items-center justify-center gap-3 overflow-hidden">
                  <div
                    onClick={() => {
                      if (currentRecord.photoDataUrl) {
                        setLightboxRecord(currentRecord);
                      }
                    }}
                    className={`relative flex-1 h-full max-h-[290px] aspect-[3/4] rounded-2xl overflow-hidden bg-washi-dark border-2 border-kin/60 shadow-inner flex items-center justify-center ${
                      currentRecord.photoDataUrl ? 'cursor-zoom-in' : ''
                    }`}
                  >
                    {currentRecord.photoDataUrl ? (
                      <>
                        <img
                          src={currentRecord.photoDataUrl}
                          alt={currentRecord.name}
                          onLoad={(e) => handleImageLoaded(currentRecord.spotId, e)}
                          className="w-full h-full object-contain"
                        />
                        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-sumi/85 text-kin border border-kin/50 text-[9px] font-serif font-bold flex items-center gap-1 shadow">
                          <ZoomIn className="w-3 h-3" />
                          <span>拡大</span>
                        </div>
                      </>
                    ) : (
                      <GoshuinSampleGraphic
                        sample={
                          currentRecord.sampleGoshuin?.[0] || {
                            calligraphy: currentRecord.name.slice(0, 4),
                            subText: currentRecord.visitedDate || '奉拝',
                            stampText: `${currentRecord.name.slice(0, 3)}印`
                          }
                        }
                        spotType={currentRecord.type}
                      />
                    )}
                    <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-washi/95 border-2 border-shuiro text-shuiro font-serif font-black text-xs rotate-[-8deg] shadow">
                      奉拝之印
                    </div>
                  </div>

                  {/* 右側の縦書き銘板 */}
                  <div className="shrink-0 h-full max-h-[270px] py-2 px-2.5 rounded-2xl bg-washi-dark/80 border border-kin/40 flex flex-col items-center justify-between">
                    <span className="text-[9px] font-serif text-kin-dark font-bold">
                      聖地巡拝
                    </span>
                    <h3 className="font-serif font-black text-lg text-sumi writing-vertical tracking-widest max-h-[190px] overflow-hidden">
                      {currentRecord.name}
                    </h3>
                    <div className="w-5 h-5 rounded-full border border-shuiro flex items-center justify-center text-[9px] font-serif font-bold text-shuiro">
                      朱
                    </div>
                  </div>
                </div>
              )}

              {/* ページ下部：場所・メモ・AI解読抜粋＆編集ボタン */}
              <div className="space-y-2 pt-2 border-t border-kin/30">
                {currentRecord.memo ? (
                  <p className="text-xs font-serif text-sumi bg-washi-dark/90 px-3 py-1.5 rounded-xl border border-kin/30 line-clamp-2">
                    「{currentRecord.memo}」
                  </p>
                ) : currentRecord.aiPhotoAnalysis?.calligraphyReading ? (
                  <p className="text-xs font-serif text-sumi bg-shuiro/5 px-3 py-1.5 rounded-xl border border-shuiro/25 line-clamp-2">
                    ✦ AI解読: {currentRecord.aiPhotoAnalysis.calligraphyReading}
                  </p>
                ) : null}

                <div className="flex items-center justify-between text-xs">
                  <span className="text-sumi-muted truncate flex items-center gap-1 max-w-[200px]">
                    <MapPin className="w-3.5 h-3.5 text-shuiro shrink-0" />
                    {currentRecord.address || currentRecord.denomination}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectRecordDetail(currentRecord);
                    }}
                    className="px-3 py-1 rounded-xl bg-sumi text-kin font-serif font-bold text-xs flex items-center gap-1 shadow active:scale-95"
                  >
                    <Edit3 className="w-3 h-3" /> 詳細・AI鑑定
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 下部ページめくりコントローラー */}
          <div className="w-full max-w-[365px] mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={pageIndex === 0}
              onClick={handlePrevPage}
              className="flex-1 py-2.5 px-4 rounded-2xl bg-white/15 backdrop-blur-md text-washi border border-kin/40 font-serif font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-30 active:scale-95 transition"
            >
              <ChevronLeft className="w-4 h-4 text-kin" />
              <span>前の頁をめくる</span>
            </button>

            <button
              type="button"
              disabled={pageIndex >= totalPages - 1}
              onClick={handleNextPage}
              className="flex-1 py-2.5 px-4 rounded-2xl bg-shuiro text-washi border border-kin font-serif font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-30 active:scale-95 transition shadow-lg"
            >
              <span>次の頁をめくる</span>
              <ChevronRight className="w-4 h-4 text-kin" />
            </button>
          </div>
          <p className="text-[10px] text-washi/60 mt-1.5 font-serif">
            ※左右にスワイプしてもページをめくれます
          </p>
        </div>
      )}

      {/* ==================== モードB: 天空の御朱印ウォール（ぶわーっと一斉に広がり宙に浮かぶ） ==================== */}
      {mode === 'skywall' && (
        <div className="relative z-10 flex-1 overflow-y-auto px-4 py-3 max-w-[430px] w-full mx-auto">
          <div className="text-center mb-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-kin/20 border border-kin/50 text-kin text-[11px] font-serif font-bold">
              <Sparkles className="w-3 h-3" />
              {bookTitle}・全 {totalPages} 社寺の御朱印曼荼羅
            </span>
            <p className="text-[11px] text-washi/75 mt-1 font-serif">
              カードをタップすると手前に大きく浮かび上がります
            </p>
          </div>

          {/* ぶわーっと飛び出す浮遊グリッド */}
          <div
            key={burstKey}
            className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 pb-10 book-perspective"
          >
            {visitedList.map((record, idx) => {
              const tiltDeg = idx % 2 === 0 ? '-1.5deg' : '1.5deg';
              const delayMs = Math.min(idx * 65, 900);
              const isWide = Boolean(wideSpotMap[record.spotId]);
              const firstSample = record.sampleGoshuin?.[0] || {
                calligraphy: record.name.slice(0, 4),
                subText: record.visitedDate || '奉拝',
                stampText: `${record.name.slice(0, 3)}印`
              };

              return (
                <div
                  key={record.spotId}
                  onClick={() => setFocusedSkyRecord(record)}
                  style={{
                    animationDelay: `${delayMs}ms`,
                    '--card-tilt': tiltDeg
                  }}
                  className={`animate-sky-burst jabara-card rounded-2xl p-2.5 border-2 border-kin shadow-[0_10px_28px_rgba(197,160,89,0.25)] cursor-pointer hover:scale-105 transition flex flex-col justify-between ${
                    isWide && record.photoDataUrl ? 'col-span-2' : ''
                  }`}
                >
                  <div
                    className={`relative w-full ${
                      isWide && record.photoDataUrl
                        ? 'max-h-48 py-1'
                        : 'aspect-[3/4]'
                    } rounded-xl overflow-hidden bg-washi-dark border border-kin/40 flex items-center justify-center mb-2`}
                  >
                    {record.photoDataUrl ? (
                      <img
                        src={record.photoDataUrl}
                        alt={record.name}
                        onLoad={(e) => handleImageLoaded(record.spotId, e)}
                        className={`w-full ${
                          isWide ? 'max-h-44 object-contain' : 'h-full object-contain'
                        }`}
                      />
                    ) : (
                      <div className="scale-90">
                        <GoshuinSampleGraphic
                          sample={firstSample}
                          spotType={record.type}
                          compact
                        />
                      </div>
                    )}
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-washi/95 border border-shuiro text-shuiro font-serif font-black text-[9px] rotate-[-8deg] shadow">
                      {isWide && record.photoDataUrl ? '見開き' : '奉拝'}
                    </div>
                  </div>

                  <div className="text-center">
                    <h4 className="font-serif font-black text-xs text-sumi truncate">
                      {record.name}
                    </h4>
                    <p className="text-[9px] text-sumi-muted truncate mt-0.5">
                      {record.visitedDate || '参拝済'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 天空ウォールで1枚をタップした時の3Dフォーカス拡大カード */}
          {focusedSkyRecord && (
            <div
              onClick={() => setFocusedSkyRecord(null)}
              className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-5 animate-slide-up"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[390px] jabara-card gold-corner-frame rounded-3xl p-4 border-2 border-kin shadow-[0_0_50px_rgba(197,160,89,0.45)] space-y-3"
              >
                <div className="flex items-center justify-between border-b border-kin/30 pb-2">
                  <div>
                    <span className="text-[10px] font-serif text-shuiro font-bold block">
                      {focusedSkyRecord.visitedDate || '参拝記録'}
                    </span>
                    <h3 className="font-serif font-black text-lg text-sumi">
                      {focusedSkyRecord.name}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFocusedSkyRecord(null)}
                    className="w-8 h-8 rounded-full bg-sumi text-washi flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div
                  onClick={() => {
                    if (focusedSkyRecord.photoDataUrl) {
                      setLightboxRecord(focusedSkyRecord);
                    }
                  }}
                  className={`relative rounded-2xl overflow-hidden border-2 border-kin/50 bg-washi-dark max-h-[52vh] flex items-center justify-center p-2 ${
                    focusedSkyRecord.photoDataUrl ? 'cursor-zoom-in' : ''
                  }`}
                >
                  {focusedSkyRecord.photoDataUrl ? (
                    <>
                      <img
                        src={focusedSkyRecord.photoDataUrl}
                        alt={focusedSkyRecord.name}
                        className="w-full h-full object-contain max-h-[48vh] rounded-xl"
                      />
                      <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-full bg-sumi/85 text-kin border border-kin/50 text-[10px] font-serif font-bold flex items-center gap-1 shadow">
                        <ZoomIn className="w-3 h-3" />
                        <span>タップでアップ表示・回転</span>
                      </div>
                    </>
                  ) : (
                    <GoshuinSampleGraphic
                      sample={
                        focusedSkyRecord.sampleGoshuin?.[0] || {
                          calligraphy: focusedSkyRecord.name.slice(0, 4),
                          subText: focusedSkyRecord.visitedDate || '奉拝',
                          stampText: `${focusedSkyRecord.name.slice(0, 3)}印`
                        }
                      }
                      spotType={focusedSkyRecord.type}
                    />
                  )}
                </div>

                {focusedSkyRecord.memo && (
                  <p className="text-xs font-serif text-sumi bg-washi-dark p-2.5 rounded-xl border border-kin/30">
                    「{focusedSkyRecord.memo}」
                  </p>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const idx = visitedList.findIndex(
                        (r) => r.spotId === focusedSkyRecord.spotId
                      );
                      if (idx >= 0) setPageIndex(idx);
                      setFocusedSkyRecord(null);
                      setMode('book3d');
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-sumi text-kin font-serif font-bold text-xs flex items-center justify-center gap-1"
                  >
                    <BookOpen className="w-3.5 h-3.5" /> 3Dブックのこの頁へ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = focusedSkyRecord;
                      setFocusedSkyRecord(null);
                      onClose();
                      onSelectRecordDetail(target);
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-shuiro text-washi font-serif font-bold text-xs flex items-center justify-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> 詳細・AI鑑定
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ★アップ拡大＆見開き回転ライトボックス */}
      <GoshuinPhotoLightbox
        record={lightboxRecord}
        onClose={() => setLightboxRecord(null)}
        onUpdatedRecord={(updated) => {
          setLightboxRecord((prev) =>
            prev ? { ...prev, photoDataUrl: updated.photoDataUrl } : null
          );
          setFocusedSkyRecord((prev) =>
            prev && prev.spotId === updated.spotId
              ? { ...prev, photoDataUrl: updated.photoDataUrl }
              : prev
          );
        }}
      />
    </div>
  );
}
