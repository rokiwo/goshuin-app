import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Smartphone,
  BookOpen,
  Calendar
} from 'lucide-react';
import { saveVisitRecord, rotateBase64Image90 } from '../db/database.js';
import GoshuinSampleGraphic from './GoshuinSampleGraphic.jsx';

/**
 * 御朱印の画像をタップしたときに起動する「アップ（拡大）＆見開きパノラマ鑑賞ライトボックス」
 * - 1倍（全体像）⇔ 2倍（アップ）⇔ 3倍（超アップ）のズーム＆指ドラッグ移動
 * - 縦向きで撮影されてしまった見開き御朱印をワンタップで「90°回転して横向き保存」する機能
 * - スマホを縦に持ったままでも画面いっぱいに見開き御朱印を大きく表示できる「横パノラマ全画面モード」
 */
export default function GoshuinPhotoLightbox({ record, onClose }) {
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState(
    record?.photoDataUrl || null
  );
  const [zoomScale, setZoomScale] = useState(1); // 1 | 2 | 2.8
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isFullLandscapeView, setIsFullLandscapeView] = useState(false);
  const [isRotatingSave, setIsRotatingSave] = useState(false);
  const [isWideImage, setIsWideImage] = useState(false);

  const dragStartRef = useRef(null);

  useEffect(() => {
    setCurrentPhotoUrl(record?.photoDataUrl || null);
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    setIsFullLandscapeView(false);
  }, [record?.spotId, record?.photoDataUrl]);

  if (!record) return null;

  // ズーム段階の切り替え（1倍 -> 2倍 -> 2.8倍 -> 1倍）
  const handleToggleZoom = () => {
    setZoomScale((prev) => {
      if (prev === 1) return 2;
      if (prev === 2) return 2.8;
      setPanOffset({ x: 0, y: 0 });
      return 1;
    });
  };

  // 写真自体の向きを90度回転して御朱印帳に上書き保存（見開き御朱印が縦になっていた時用）
  const handleRotateAndSavePhoto = async () => {
    if (!currentPhotoUrl || isRotatingSave) return;
    setIsRotatingSave(true);
    try {
      const rotatedUrl = await rotateBase64Image90(currentPhotoUrl, true);
      setCurrentPhotoUrl(rotatedUrl);
      setZoomScale(1);
      setPanOffset({ x: 0, y: 0 });

      await saveVisitRecord(
        {
          id: record.spotId,
          name: record.name,
          type: record.type,
          denomination: record.denomination,
          address: record.address,
          lat: record.lat,
          lng: record.lng,
          sampleGoshuin: record.sampleGoshuin
        },
        {
          visited: true,
          visitedDate: record.visitedDate,
          photoDataUrl: rotatedUrl,
          memo: record.memo
        }
      );
    } catch (err) {
      console.error('画像回転エラー:', err);
    } finally {
      setIsRotatingSave(false);
    }
  };

  // ズーム中の指ドラッグ・マウスドラッグ移動処理
  const handlePointerDown = (clientX, clientY) => {
    if (zoomScale <= 1) return;
    dragStartRef.current = {
      startX: clientX - panOffset.x,
      startY: clientY - panOffset.y
    };
  };

  const handlePointerMove = (clientX, clientY) => {
    if (!dragStartRef.current || zoomScale <= 1) return;
    const nextX = Math.max(-260, Math.min(260, clientX - dragStartRef.current.startX));
    const nextY = Math.max(-320, Math.min(320, clientY - dragStartRef.current.startY));
    setPanOffset({ x: nextX, y: nextY });
  };

  const handlePointerUp = () => {
    dragStartRef.current = null;
  };

  const firstSample = record.sampleGoshuin?.[0] || {
    calligraphy: record.name.slice(0, 4),
    subText: record.visitedDate || '奉拝',
    stampText: `${record.name.slice(0, 3)}印`
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-sumi/95 backdrop-blur-md flex flex-col justify-between p-3 sm:p-5 select-none animate-slide-up"
    >
      {/* 上部ヘッダーバー */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[430px] mx-auto flex items-center justify-between gap-2 bg-white/10 backdrop-blur-md border border-kin/40 rounded-2xl px-3.5 py-2.5 z-20"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-serif text-kin font-bold">
            <Calendar className="w-3 h-3 text-shuiro shrink-0" />
            <span>{record.visitedDate || '参拝記録'}</span>
            {isWideImage && (
              <span className="px-1.5 py-0.2 rounded bg-shuiro text-washi text-[9px]">
                📖 見開き御朱印
              </span>
            )}
          </div>
          <h3 className="font-serif font-black text-base text-washi truncate">
            {record.name}
          </h3>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 text-washi border border-white/25 flex items-center justify-center shrink-0 active:scale-95"
          aria-label="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 中央：御朱印アップ（拡大）＆見開き全体像ビューア */}
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => handlePointerDown(e.clientX, e.clientY)}
        onMouseMove={(e) => handlePointerMove(e.clientX, e.clientY)}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            handlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 1) {
            handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        onTouchEnd={handlePointerUp}
        onDoubleClick={handleToggleZoom}
        className="relative flex-1 w-full max-w-[430px] mx-auto my-2 flex items-center justify-center overflow-hidden rounded-3xl border-2 border-kin/50 bg-[#1a1817] shadow-[0_0_50px_rgba(0,0,0,0.8)]"
      >
        {currentPhotoUrl ? (
          <div
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale}) rotate(${
                isFullLandscapeView ? 90 : 0
              }deg)`,
              transition: dragStartRef.current ? 'none' : 'transform 0.25s ease-out'
            }}
            className={`flex items-center justify-center ${
              isFullLandscapeView
                ? 'w-[70vh] h-[88vw] max-w-none'
                : 'w-full h-full p-2'
            } ${zoomScale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
          >
            <img
              src={currentPhotoUrl}
              alt={record.name}
              onLoad={(e) => {
                const { naturalWidth, naturalHeight } = e.currentTarget;
                setIsWideImage(naturalWidth > naturalHeight * 1.02);
              }}
              onClick={() => {
                if (zoomScale === 1) handleToggleZoom();
              }}
              draggable={false}
              className="max-w-full max-h-full object-contain rounded-xl shadow-2xl border border-kin/40"
            />
          </div>
        ) : (
          <div
            style={{
              transform: `scale(${zoomScale})`,
              transition: 'transform 0.25s ease-out'
            }}
            onClick={handleToggleZoom}
            className="p-4 cursor-zoom-in"
          >
            <GoshuinSampleGraphic sample={firstSample} spotType={record.type} />
          </div>
        )}

        {/* ズーム倍率ガイドバッジ */}
        <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/70 border border-kin/40 text-[10px] font-serif text-kin pointer-events-none">
          {zoomScale > 1
            ? `🔍 ${zoomScale}倍アップ中（指で動かして細部を見られます）`
            : '💡 画像をタップするとさらにアップ（拡大）できます'}
        </div>
      </div>

      {/* 下部コントロールバー（アップ拡大・見開き90°回転保存・横画面フル表示） */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[430px] mx-auto space-y-2 z-20"
      >
        {record.memo && (
          <div className="px-3.5 py-2 rounded-2xl bg-washi/95 border border-kin text-xs font-serif text-sumi text-center truncate">
            「{record.memo}」
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {/* ① アップ（拡大 / 縮小）ボタン */}
          <button
            type="button"
            onClick={handleToggleZoom}
            className={`py-2.5 px-2 rounded-2xl border font-serif font-bold text-xs flex items-center justify-center gap-1 shadow-lg active:scale-95 transition ${
              zoomScale > 1
                ? 'bg-kin text-sumi border-kin'
                : 'bg-white/15 text-washi border-kin/40 hover:bg-white/25'
            }`}
          >
            {zoomScale > 1 ? (
              <>
                <ZoomOut className="w-3.5 h-3.5" />
                <span>全体に戻す</span>
              </>
            ) : (
              <>
                <ZoomIn className="w-3.5 h-3.5 text-kin" />
                <span>アップ拡大</span>
              </>
            )}
          </button>

          {/* ② 見開き御朱印などで写真が縦向きになっていた時に横向きへ90°回転して保存するボタン */}
          {currentPhotoUrl ? (
            <button
              type="button"
              disabled={isRotatingSave}
              onClick={handleRotateAndSavePhoto}
              className="py-2.5 px-2 rounded-2xl bg-shuiro hover:bg-shuiro-dark text-washi border border-kin/60 font-serif font-bold text-xs flex items-center justify-center gap-1 shadow-lg active:scale-95 transition disabled:opacity-50"
              title="写真の向きを90度回転して横向き（または縦向き）に保存します"
            >
              <RotateCw
                className={`w-3.5 h-3.5 text-kin ${
                  isRotatingSave ? 'animate-spin' : ''
                }`}
              />
              <span>写真を横へ回転</span>
            </button>
          ) : (
            <div />
          )}

          {/* ③ スマホ画面いっぱいに横向きで見開き表示するボタン */}
          {currentPhotoUrl ? (
            <button
              type="button"
              onClick={() => {
                setIsFullLandscapeView((v) => !v);
                setZoomScale(1);
                setPanOffset({ x: 0, y: 0 });
              }}
              className={`py-2.5 px-2 rounded-2xl border font-serif font-bold text-xs flex items-center justify-center gap-1 shadow-lg active:scale-95 transition ${
                isFullLandscapeView
                  ? 'bg-kin text-sumi border-kin'
                  : 'bg-white/15 text-washi border-kin/40 hover:bg-white/25'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-kin" />
              <span>{isFullLandscapeView ? '通常向き' : '見開き大画面'}</span>
            </button>
          ) : (
            <div />
          )}
        </div>
      </div>
    </div>
  );
}
