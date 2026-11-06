import React, { useState, useEffect } from 'react';
import { X, KeyRound, Sparkles, Check, ExternalLink, ShieldCheck, Cpu } from 'lucide-react';
import {
  AVAILABLE_GEMINI_MODELS,
  DEFAULT_GEMINI_MODEL,
  getGeminiApiKey,
  setGeminiApiKey,
  getGeminiModel,
  setGeminiModel
} from '../services/geminiService.js';

/**
 * Gemini APIキーと使用モデル（デフォルト: gemini-3.8-flash）をスマホ端末内に保存する設定モーダル
 * サーバーを介さず端末（localStorage）から直接Google APIへ通信するため、家のPCを消していても外出先で24時間動作します
 */
export default function AiSettingsModal({ isOpen, onClose, onUpdated }) {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_GEMINI_MODEL);
  const [customModel, setCustomModel] = useState('');
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setApiKeyInput(getGeminiApiKey());
      const currentModel = getGeminiModel();
      const isPreset = AVAILABLE_GEMINI_MODELS.some((m) => m.id === currentModel);
      if (isPreset) {
        setSelectedModel(currentModel);
        setCustomModel('');
      } else {
        setSelectedModel('custom');
        setCustomModel(currentModel);
      }
      setSavedToast(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = (e) => {
    e.preventDefault();
    setGeminiApiKey(apiKeyInput);
    const finalModel =
      selectedModel === 'custom'
        ? customModel.trim() || DEFAULT_GEMINI_MODEL
        : selectedModel;
    setGeminiModel(finalModel);
    setSavedToast(true);
    if (onUpdated) onUpdated(Boolean(apiKeyInput.trim()));
    setTimeout(() => {
      setSavedToast(false);
      onClose();
    }, 650);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sumi/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-[400px] washi-pattern rounded-3xl border-2 border-kin shadow-2xl overflow-hidden animate-slide-up">
        {/* ヘッダー */}
        <div className="bg-sumi text-washi px-5 py-4 border-b border-kin/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-kin" />
            <h2 className="font-serif font-bold text-base tracking-wide">
              Gemini 3.8 Flash AI設定
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-washi/10 text-washi flex items-center justify-center hover:bg-washi/20"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* フォーム本体 */}
        <form onSubmit={handleSave} className="p-5 space-y-4 text-xs text-sumi max-h-[80vh] overflow-y-auto">
          <div className="rounded-2xl bg-washi-dark p-3.5 border border-kin/40 space-y-1.5">
            <div className="flex items-center gap-1.5 font-serif font-bold text-sumi">
              <ShieldCheck className="w-4 h-4 text-tera shrink-0" />
              <span>スマホ単体・外出先で24時間動作</span>
            </div>
            <p className="text-[11px] text-sumi-muted leading-relaxed">
              APIキーはお使いのスマホブラウザ内にのみ安全に保存され、Google公式APIへ直接通信します。家のPCを起動しておく必要は一切ありません。
            </p>
          </div>

          {/* APIキー入力 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-serif font-bold text-sm flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-shuiro" />
                Gemini API キー
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-shuiro font-bold flex items-center gap-0.5 hover:underline"
              >
                Google AI Studioで取得 <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full rounded-xl border border-washi-border bg-washi px-3.5 py-2.5 text-xs font-mono text-sumi focus:outline-none focus:border-shuiro"
            />
            <p className="text-[10px] text-sumi-muted">
              ※月10ドルのご予算があれば、Gemini 3.8 Flashで月間数千〜数万回の御朱印写真鑑定＆寺社ガイドが余裕で使えます。
            </p>
          </div>

          {/* モデル選択 */}
          <div className="space-y-2">
            <label className="font-serif font-bold text-sm flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-kin-dark" />
              使用するAIモデル（標準: Gemini 3.8 Flash）
            </label>

            <div className="space-y-2">
              {AVAILABLE_GEMINI_MODELS.map((m) => (
                <label
                  key={m.id}
                  className={`block rounded-xl p-3 border cursor-pointer transition ${
                    selectedModel === m.id
                      ? 'bg-shuiro-light border-shuiro ring-1 ring-shuiro'
                      : 'bg-washi border-washi-border hover:border-kin'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="geminiModel"
                        value={m.id}
                        checked={selectedModel === m.id}
                        onChange={() => setSelectedModel(m.id)}
                        className="accent-shuiro"
                      />
                      <span className="font-serif font-bold text-xs text-sumi">
                        {m.name}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-sumi-muted bg-washi-dark px-1.5 py-0.5 rounded">
                      {m.id}
                    </span>
                  </div>
                  <p className="text-[11px] text-sumi-muted mt-1 pl-5">
                    {m.description}
                  </p>
                </label>
              ))}

              {/* カスタムモデル名指定 */}
              <label
                className={`block rounded-xl p-3 border cursor-pointer transition ${
                  selectedModel === 'custom'
                    ? 'bg-shuiro-light border-shuiro ring-1 ring-shuiro'
                    : 'bg-washi border-washi-border hover:border-kin'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="geminiModel"
                    value="custom"
                    checked={selectedModel === 'custom'}
                    onChange={() => setSelectedModel('custom')}
                    className="accent-shuiro"
                  />
                  <span className="font-serif font-bold text-xs text-sumi">
                    任意のモデルIDを直接指定
                  </span>
                </div>
                {selectedModel === 'custom' && (
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="例: gemini-3.8-flash"
                    className="mt-2 w-full rounded-lg border border-washi-border bg-washi px-3 py-1.5 text-xs font-mono"
                  />
                )}
              </label>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-shuiro text-washi font-serif font-bold text-sm shadow-lg flex items-center justify-center gap-2 active:scale-95 transition"
          >
            {savedToast ? (
              <>
                <Check className="w-4 h-4" /> 設定を保存しました！
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-kin" /> 設定を保存してAI機能を有効化
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
