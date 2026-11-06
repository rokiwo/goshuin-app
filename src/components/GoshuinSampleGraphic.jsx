import React from 'react';

/**
 * 寺社ごとの御朱印見本（墨書・朱印・モチーフ）を和紙カードとして美しく描画するコンポーネント
 * どの寺社をタップしても本格的な和風御朱印プレビューを楽しめます
 */
export default function GoshuinSampleGraphic({ sample, spotType = 'shrine', compact = false }) {
  const calligraphy = sample?.calligraphy || '奉拝';
  const subText = sample?.subText || '参拝記念';
  const stampText = sample?.stampText || '御朱印';
  const motif = sample?.motif || (spotType === 'shrine' ? 'torii' : 'lotus');

  return (
    <div
      className={`jabara-card relative overflow-hidden rounded-xl border border-kin/40 select-none flex flex-col justify-between ${
        compact ? 'w-28 h-36 p-2.5' : 'w-40 h-52 p-3.5'
      } shrink-0`}
    >
      {/* 背景の淡い金箔・季節モチーフ装飾 */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        {motif === 'moon-wave' && (
          <svg viewBox="0 0 120 160" className="w-full h-full">
            <circle cx="88" cy="34" r="20" fill="#c5a059" />
            <path
              d="M0 130 Q30 115 60 130 T120 130 L120 160 L0 160 Z"
              fill="#c93a40"
            />
          </svg>
        )}
        {motif === 'wave' && (
          <svg viewBox="0 0 120 160" className="w-full h-full">
            <path
              d="M0 125 Q20 110 40 125 T80 125 T120 125 L120 160 L0 160 Z"
              fill="#c5a059"
            />
          </svg>
        )}
        {motif === 'flower' && (
          <svg viewBox="0 0 120 160" className="w-full h-full">
            <circle cx="28" cy="32" r="14" fill="#c93a40" />
            <circle cx="95" cy="125" r="18" fill="#c5a059" />
          </svg>
        )}
        {motif === 'lotus' && (
          <svg viewBox="0 0 120 160" className="w-full h-full">
            <ellipse cx="60" cy="135" rx="38" ry="12" fill="#2d6a4f" />
            <path d="M60 95 C45 115 45 135 60 142 C75 135 75 115 60 95 Z" fill="#c93a40" />
          </svg>
        )}
      </div>

      {/* 右上の奉拝印（斜め楕円印） */}
      <div className="flex justify-between items-start z-10">
        <span className="inline-block px-1.5 py-0.5 text-[9px] font-serif tracking-wider border border-shuiro/70 text-shuiro rounded-sm rotate-[-6deg] bg-washi/80">
          奉拝之印
        </span>
        <span className="text-[9px] text-sumi-muted font-serif writing-vertical h-14 leading-tight">
          {subText}
        </span>
      </div>

      {/* 中央の朱印（角印＋神紋/宝印）と墨書 */}
      <div className="relative flex items-center justify-center flex-1 my-1">
        {/* 中央背景の朱色角印 */}
        <div
          className={`absolute border-2 border-shuiro/65 rounded-sm flex items-center justify-center p-1 rotate-[-4deg] bg-shuiro/5 ${
            compact ? 'w-14 h-14' : 'w-20 h-20'
          }`}
        >
          <div className="w-full h-full border border-shuiro/45 flex items-center justify-center text-center">
            <span className="text-[9px] leading-none font-serif font-bold text-shuiro/70 tracking-tighter">
              {stampText}
            </span>
          </div>
        </div>

        {/* 中央の墨書（縦書き毛筆風セリフ） */}
        <div
          className={`relative z-10 font-serif font-black text-sumi writing-vertical tracking-widest drop-shadow-sm ${
            compact ? 'text-lg' : 'text-2xl'
          }`}
        >
          {calligraphy}
        </div>
      </div>

      {/* 左下の社寺丸印 */}
      <div className="flex justify-between items-end z-10">
        <div className="w-6 h-6 rounded-full border-2 border-shuiro/80 flex items-center justify-center bg-shuiro/10">
          <span className="text-[8px] font-serif font-bold text-shuiro">
            {spotType === 'shrine' ? '神' : '佛'}
          </span>
        </div>
        <span className="text-[9px] font-serif text-kin-dark font-semibold">
          御朱印見本
        </span>
      </div>
    </div>
  );
}
