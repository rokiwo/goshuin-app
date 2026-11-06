import React, { useState, useRef } from 'react';
import {
  X,
  Download,
  Upload,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  HelpCircle,
  FileCheck,
  Sparkles,
  ArrowRight,
  ChevronLeft
} from 'lucide-react';
import { exportGoshuinBackup, importGoshuinBackup } from '../db/database.js';

/**
 * 御朱印アプリの全データ（写真・メモ・実物御朱印帳・巡拝グループ・設定）を
 * ワンタップでバックアップ書き出し（ダウンロード）および復元（インポート）できるモーダル
 * ★GitHub移行や機種変更時にデータを100%引き継ぐための必須機能
 */
export default function DataBackupModal({
  isOpen,
  onClose,
  totalVisits = 0,
  totalBooks = 0,
  onImportSuccess
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  
  const [selectedFile, setSelectedFile] = useState(null);
  const [importMode, setImportMode] = useState('merge'); // 'merge' | 'replace'
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  // データ書き出し（エクスポート）
  const handleExport = async () => {
    try {
      setIsExporting(true);
      setErrorMessage('');
      const res = await exportGoshuinBackup();
      setExportMessage(`『${res.fileName}』としてダウンロードしました！（御朱印: ${res.visitsCount}件 / 御朱印帳: ${res.booksCount}冊）`);
    } catch (err) {
      console.error(err);
      setErrorMessage('データの書き出しに失敗しました: ' + (err.message || ''));
    } finally {
      setIsExporting(false);
    }
  };

  // ファイル選択時
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setImportMessage('');
    setErrorMessage('');
  };

  // データ読み込み（インポート）
  const handleImport = async () => {
    if (!selectedFile) {
      setErrorMessage('バックアップファイル（.json）を選択してください。');
      return;
    }

    if (importMode === 'replace') {
      const ok = window.confirm(
        '【注意】完全上書きを選択しています。\n現在端末に保存されている御朱印データはすべて消去され、バックアップファイルの内容に置き換わります。\nよろしいですか？'
      );
      if (!ok) return;
    }

    try {
      setIsImporting(true);
      setErrorMessage('');
      const text = await selectedFile.text();
      const res = await importGoshuinBackup(text, importMode);
      setImportMessage(`データを復元しました！（御朱印: ${res.visitsCount}件 / 御朱印帳: ${res.booksCount}冊）`);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (onImportSuccess) onImportSuccess(res);
    } catch (err) {
      console.error(err);
      setErrorMessage('復元に失敗しました。正しいJSONバックアップファイルかご確認ください: ' + (err.message || ''));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-sumi/75 backdrop-blur-sm p-0 sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 w-full max-w-[460px] max-h-[92vh] washi-pattern rounded-t-3xl sm:rounded-3xl border-t-2 sm:border-2 border-kin shadow-2xl flex flex-col animate-slide-up overflow-hidden">
        {/* スマホ用シートグラブハンドル */}
        <div className="w-full flex justify-center pt-2 pb-1 bg-sumi sm:hidden">
          <div className="w-12 h-1 rounded-full bg-washi/30" />
        </div>

        {/* ヘッダー: 左に戻るボタン、右に閉じるボタンを明示 */}
        <div className="bg-sumi text-washi px-3 sm:px-5 py-3 border-b border-kin/40 flex items-center justify-between shrink-0 gap-2">
          {/* 左: 戻るボタン */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-washi/10 hover:bg-washi/20 text-washi text-xs font-serif font-bold active:scale-95 transition border border-washi/20"
            title="前の画面に戻る"
          >
            <ChevronLeft className="w-4 h-4 text-kin" />
            <span>戻る</span>
          </button>

          {/* 中央: タイトル */}
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-shuiro border border-kin flex items-center justify-center font-serif font-black text-xs text-washi shrink-0">
              保
            </div>
            <div className="min-w-0 text-center sm:text-left">
              <h3 className="font-serif font-black text-xs sm:text-sm text-kin truncate">
                データ移行・保存
              </h3>
            </div>
          </div>

          {/* 右: 閉じるボタン */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-shuiro/30 hover:bg-shuiro/50 text-washi text-xs font-serif font-bold active:scale-95 transition border border-shuiro/50"
            title="閉じる"
          >
            <span>閉じる</span>
            <X className="w-4 h-4 text-washi" />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sumi">
          {/* 現在のデータ状態 */}
          <div className="p-3 rounded-2xl bg-washi border border-kin/40 shadow-sm flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[10px] text-sumi-muted font-serif block">
                現在端末に登録されているデータ
              </span>
              <p className="font-serif font-bold text-xs text-sumi">
                御朱印 <span className="text-shuiro font-black text-sm">{totalVisits}</span> 件 ／ 冊別御朱印帳 <span className="text-kin-dark font-black text-sm">{totalBooks}</span> 冊
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-kin/20 text-sumi font-serif text-[10px]">
              写真含む全データ
            </span>
          </div>

          {/* セクション1: データの書き出し（バックアップ） */}
          <div className="space-y-2 p-3.5 rounded-2xl bg-washi border border-kin/30 shadow-sm">
            <div className="flex items-center gap-1.5">
              <Download className="w-4 h-4 text-shuiro" />
              <h4 className="font-serif font-bold text-xs text-sumi">
                1. データをファイルに書き出す（バックアップ保存）
              </h4>
            </div>
            <p className="text-[11px] text-sumi-muted leading-relaxed font-serif">
              これまでに登録した全ての御朱印写真、参拝日、メモ、実物御朱印帳、巡拝グループを丸ごと1つのファイル（JSON）として端末にダウンロード保存します。
            </p>

            <button
              type="button"
              disabled={isExporting}
              onClick={handleExport}
              className="w-full py-2.5 rounded-xl bg-shuiro hover:bg-shuiro-dark text-washi font-serif font-bold text-xs shadow flex items-center justify-center gap-1.5 active:scale-95 transition disabled:opacity-60"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-kin" />
                  <span>ファイルを書き出し中...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 text-kin" />
                  <span>御朱印データを丸ごと書き出す（保存）</span>
                </>
              )}
            </button>

            {exportMessage && (
              <div className="p-2 rounded-xl bg-kin/15 border border-kin/40 text-[11px] font-serif text-sumi flex items-start gap-1.5 animate-fade-in">
                <CheckCircle2 className="w-4 h-4 text-shuiro shrink-0 mt-0.5" />
                <span className="break-all">{exportMessage}</span>
              </div>
            )}
          </div>

          {/* セクション2: データの復元（インポート） */}
          <div className="space-y-2.5 p-3.5 rounded-2xl bg-washi border border-kin/30 shadow-sm">
            <div className="flex items-center gap-1.5">
              <Upload className="w-4 h-4 text-kin-dark" />
              <h4 className="font-serif font-bold text-xs text-sumi">
                2. バックアップから復元（データ引き継ぎ）
              </h4>
            </div>
            <p className="text-[11px] text-sumi-muted leading-relaxed font-serif">
              書き出したバックアップファイル（.json）を選択して、新しいURLや別端末にデータを引き継ぎ・復元します。
            </p>

            {/* ファイル選択 */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-xl border-2 border-dashed border-kin/60 bg-washi hover:bg-washi-dark transition text-center cursor-pointer"
            >
              {selectedFile ? (
                <div className="flex items-center justify-center gap-1.5 text-xs font-serif font-bold text-sumi">
                  <FileCheck className="w-4 h-4 text-shuiro" />
                  <span className="truncate max-w-[280px]">{selectedFile.name}</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 text-sumi-muted">
                  <Upload className="w-5 h-5 text-kin-dark" />
                  <span className="text-[11px] font-serif font-bold">
                    タップしてバックアップファイル（.json）を選択
                  </span>
                </div>
              )}
            </div>

            {/* 復元モード選択 */}
            <div className="flex gap-2 text-[11px] font-serif">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="importMode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  className="text-shuiro focus:ring-0"
                />
                <span>追加・統合（既存データを保持）</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="text-shuiro focus:ring-0"
                />
                <span>完全上書き（既存を置き換え）</span>
              </label>
            </div>

            <button
              type="button"
              disabled={!selectedFile || isImporting}
              onClick={handleImport}
              className="w-full py-2.5 rounded-xl bg-sumi hover:bg-sumi-light text-kin font-serif font-bold text-xs shadow border border-kin flex items-center justify-center gap-1.5 active:scale-95 transition disabled:opacity-50"
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-kin" />
                  <span>データを復元中...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5 text-kin" />
                  <span>バックアップから復元を実行する</span>
                </>
              )}
            </button>

            {importMessage && (
              <div className="p-2 rounded-xl bg-shuiro/15 border border-shuiro/40 text-[11px] font-serif text-sumi flex items-start gap-1.5 animate-fade-in">
                <CheckCircle2 className="w-4 h-4 text-shuiro shrink-0 mt-0.5" />
                <span>{importMessage}</span>
              </div>
            )}
          </div>

          {/* セクション3: GitHubへのデータ移行ガイド */}
          <div className="p-3.5 rounded-2xl bg-washi-dark/80 border border-washi-border space-y-1.5 text-[11px] font-serif text-sumi leading-relaxed">
            <div className="flex items-center gap-1 font-bold text-sumi">
              <Sparkles className="w-3.5 h-3.5 text-kin-dark" />
              <span>GitHub移行の手順</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-sumi-muted pl-0.5">
              <li>上の「1. データを丸ごと書き出す」でバックアップをスマホに保存</li>
              <li>GitHub Pagesの新しいURLでアプリを開く</li>
              <li>「2. バックアップから復元」で保存したファイルを選ぶだけで、すべての御朱印写真や記録が一瞬でそのまま引き継がれます</li>
            </ol>
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-shuiro/10 border border-shuiro text-shuiro text-xs font-serif flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* 固定下部バー: どこまでスクロールしても常に親指で押せる「戻る」ボタン */}
        <div className="bg-sumi text-washi p-3 border-t border-kin/40 shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-washi/15 hover:bg-washi/25 text-washi font-serif font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition border border-washi/20 shadow-md"
          >
            <ChevronLeft className="w-4 h-4 text-kin" />
            <span>前の画面に戻る</span>
          </button>
        </div>
      </div>
    </div>
  );
}
