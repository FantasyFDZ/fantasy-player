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

  // 每次 qr 变化时启动轮询
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
          setStatus(
            "message" in result ? result.message : "已登录",
          );
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

  if (user) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-white/5 px-4 py-3">
        {user.avatar_url && (
          <img
            src={user.avatar_url}
            alt=""
            className="h-10 w-10 rounded-full"
          />
        )}
        <div className="flex-1">
          <div className="font-medium">{user.nickname}</div>
          <div className="text-xs text-white/50">
            VIP {user.vip_type > 0 ? "✓" : "—"}
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="rounded bg-white/10 px-3 py-1 text-sm hover:bg-white/20"
        >
          退出
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg bg-white/5 p-4">
      {!qr ? (
        <button
          onClick={handleStart}
          disabled={loading}
          className="rounded bg-emerald-500/80 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? "正在生成..." : "扫码登录网易云"}
        </button>
      ) : (
        <div className="flex flex-col items-start gap-2">
          {qr.qr_img ? (
            <img
              src={qr.qr_img}
              alt="QR"
              className="h-40 w-40 rounded bg-white p-2"
            />
          ) : (
            <div className="text-xs text-white/60">
              二维码链接: {qr.qr_url}
            </div>
          )}
          <button
            onClick={() => setQr(null)}
            className="text-xs text-white/60 underline"
          >
            取消
          </button>
        </div>
      )}
      {status && <div className="text-xs text-white/60">{status}</div>}
    </div>
  );
}
