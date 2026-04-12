// 登录面板 —— Phase 2 主题化。
// 沿用父 Overlay 的木纹卡片背景；按钮 / QR 容器用金属质感呼应。

import { useEffect, useState } from "react";
import { api, type QrStartReceipt, type UserProfile } from "@/lib/api";

interface Props {
  user: UserProfile | null;
  onLogin: (user: UserProfile) => void;
  onLogout: () => void;
}

export function LoginPanel({ user, onLogin, onLogout }: Props) {
  const [qr, setQr] = useState<QrStartReceipt | null>(null);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!qr || user) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, 1500));
        if (cancelled) return;
        try {
          const result = await api.qrCheck();
          if (cancelled) return;
          setStatus("message" in result ? result.message : "已登录");
          if (result.status === "ok") {
            onLogin(result.user);
            return;
          }
          if (result.status === "expired") {
            setQr(null);
            return;
          }
        } catch (err) {
          setStatus(String(err));
          return;
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [qr, user, onLogin]);

  const handleStart = async () => {
    setLoading(true);
    setStatus("正在获取二维码...");
    try {
      const receipt = await api.qrStart();
      setQr(receipt);
      setStatus("请用网易云 App 扫码");
    } catch (err) {
      setStatus(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setQr(null);
    setStatus("已退出登录");
    onLogout();
  };

  return (
    <div className="flex h-full flex-col">
      <div
        className="mb-4 font-mono text-[10px] uppercase"
        style={{
          color: "var(--theme-wood-highlight)",
          letterSpacing: "0.24em",
          filter: "brightness(1.4)",
          textShadow: "0 1px 0 rgba(0,0,0,0.7)",
        }}
      >
        NetEase Account
      </div>

      {user ? (
        <LoggedInView user={user} onLogout={handleLogout} />
      ) : (
        <QrLoginView
          qr={qr}
          status={status}
          loading={loading}
          onStart={handleStart}
          onCancel={() => setQr(null)}
        />
      )}
    </div>
  );
}

function LoggedInView({
  user,
  onLogout,
}: {
  user: UserProfile;
  onLogout: () => void;
}) {
  return (
    <div
      className="flex items-center gap-4 rounded-md p-4"
      style={{
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(0,0,0,0.45)",
        boxShadow: "inset 0 2px 6px rgba(0,0,0,0.5)",
      }}
    >
      {user.avatar_url && (
        <img
          src={user.avatar_url}
          alt=""
          className="h-14 w-14 rounded-full"
          style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.6)" }}
        />
      )}
      <div className="flex-1">
        <div
          className="font-display text-[20px]"
          style={{ color: "rgba(255,240,220,0.95)" }}
        >
          {user.nickname}
        </div>
        <div
          className="font-mono text-[10px] uppercase"
          style={{
            color: "rgba(255,220,180,0.6)",
            letterSpacing: "0.12em",
          }}
        >
          VIP · {user.vip_type > 0 ? "yes" : "standard"}
        </div>
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="rounded-md px-4 py-2 text-sm transition-all hover:scale-[1.03]"
        style={{
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--theme-accent)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
          border: "1px solid var(--theme-accent)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.15), 0 2px 4px rgba(0,0,0,0.5)",
        }}
      >
        退出
      </button>
    </div>
  );
}

function QrLoginView({
  qr,
  status,
  loading,
  onStart,
  onCancel,
}: {
  qr: QrStartReceipt | null;
  status: string;
  loading: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 rounded-md p-6"
      style={{
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(0,0,0,0.45)",
        boxShadow: "inset 0 2px 6px rgba(0,0,0,0.5)",
      }}
    >
      {!qr ? (
        <button
          type="button"
          onClick={onStart}
          disabled={loading}
          className="rounded-md px-6 py-3 text-sm transition-all hover:scale-[1.03] disabled:opacity-50"
          style={{
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--theme-accent)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.1), rgba(0,0,0,0.35))",
            border: "1px solid var(--theme-accent)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 8px rgba(0,0,0,0.55)",
          }}
        >
          {loading ? "生成中..." : "扫码登录网易云"}
        </button>
      ) : (
        <div className="flex flex-col items-center gap-3">
          {/* QR 图在金属框里 */}
          <div
            className="rounded-md p-3"
            style={{
              background: "#ffffff",
              boxShadow:
                "0 0 0 2px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.5)",
            }}
          >
            {qr.qr_img ? (
              <img src={qr.qr_img} alt="QR" className="h-44 w-44" />
            ) : (
              <div className="flex h-44 w-44 items-center justify-center text-xs text-black">
                二维码链接: {qr.qr_url}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-[11px] underline"
            style={{
              color: "rgba(255,220,180,0.7)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
            }}
          >
            取消
          </button>
        </div>
      )}
      {status && (
        <div
          className="text-center text-[12px]"
          style={{
            color: "rgba(255,240,220,0.8)",
            fontFamily: "var(--font-display)",
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}
