//! 平台特定小工具。
//!
//! 目前只做一件事：给 `std::process::Command` 加上在 Windows 上隐藏
//! console 窗口的 flag。不加的话每次 spawn Node / Python 都会闪一下
//! 黑色 cmd 窗口（用户视角非常吵）。

use std::process::Command;

/// 让 Command 在 Windows 下 spawn 时不弹 console 窗口。
/// 其它平台空操作。链式返回同一 Command 引用，支持 `.arg().arg()` 之后无缝接上。
#[allow(unused_variables, clippy::needless_return)]
pub fn hide_console(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
