import { useEffect, useState } from "react";
import { LoginPanel } from "@/components/LoginPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { PlayBar } from "@/components/PlayBar";
import { api, type Song, type UserProfile } from "@/lib/api";

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [tab, setTab] = useState<"search" | "account">("search");

  // 启动时拉一次 session
  useEffect(() => {
    api.session().then((session) => {
      if (session.user) setUser(session.user);
    });
  }, []);

  const handlePlay = async (song: Song, queue: Song[]) => {
    setCurrentSong(song);
    try {
      await api.queueReplace(queue, 0);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div
      className="flex h-screen flex-col bg-gradient-to-br from-slate-900 via-slate-950 to-black"
      data-tauri-drag-region
    >
      {/* top bar — draggable region (decorations=false) */}
      <div
        className="flex items-center justify-between border-b border-white/5 px-5 py-3"
        data-tauri-drag-region
      >
        <div
          className="text-sm font-light tracking-[0.3em] text-white/70"
          data-tauri-drag-region
        >
          MELODY
        </div>
        <div className="flex gap-1 text-xs">
          <TabButton
            active={tab === "search"}
            onClick={() => setTab("search")}
            label="搜索"
          />
          <TabButton
            active={tab === "account"}
            onClick={() => setTab("account")}
            label="账号"
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden p-5">
        {tab === "search" ? (
          <div className="flex flex-1 flex-col">
            <SearchPanel onPlay={handlePlay} />
          </div>
        ) : (
          <div className="flex-1">
            <LoginPanel
              user={user}
              onLogin={setUser}
              onLogout={() => setUser(null)}
            />
          </div>
        )}
      </div>

      <PlayBar currentSong={currentSong} />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded px-3 py-1 transition-colors " +
        (active
          ? "bg-white/10 text-white"
          : "text-white/50 hover:bg-white/5 hover:text-white/80")
      }
    >
      {label}
    </button>
  );
}
