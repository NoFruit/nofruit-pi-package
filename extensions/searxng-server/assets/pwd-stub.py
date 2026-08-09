# pwd stub for Windows（searxng win-only 部署用；Unix 有真 pwd，此桩不遮蔽）
# 接口对齐标准库 pwd；searxng 仅在 valkey 连接失败的日志分支调用 getpwuid，返回假账户数据即可
import os


class pwd_entry:
    def __init__(self, name, uid, gid, gecos, dir, shell):
        self.pw_name = name
        self.pw_passwd = "x"
        self.pw_uid = uid
        self.pw_gid = gid
        self.pw_gecos = gecos
        self.pw_dir = dir
        self.pw_shell = shell


def getpwuid(uid):
    return pwd_entry(
        os.environ.get("USERNAME", "unknown"),
        uid,
        -1,
        "",
        os.path.expanduser("~"),
        "",
    )


def getpwnam(name):
    return pwd_entry(name, -1, -1, "", os.path.expanduser("~"), "")


def getpwall():
    return [getpwuid(-1)]
