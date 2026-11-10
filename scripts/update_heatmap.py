import os
import json
from math import log
import datetime
import july
from july.utils import date_range
import matplotlib.pyplot as plt
import matplotlib.cbook
import warnings
from pathlib import Path

from activity_stats import recover_pending_updates, tcx_distance, write_atomically

# --- 1. 兼容性补丁 ---
if not hasattr(matplotlib.cbook, "MatplotlibDeprecationWarning"):
    matplotlib.cbook.MatplotlibDeprecationWarning = (
        matplotlib.MatplotlibDeprecationWarning
    )
warnings.filterwarnings("ignore")

# --- 2. 路径配置 ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
STATS_FILE = os.path.join(DATA_DIR, "stats.json")
OUTPUT_IMAGE = os.path.join(DATA_DIR, "profile-heatmap.png")


# --- 辅助函数 ---
def load_stats():
    if os.path.exists(STATS_FILE):
        with open(STATS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"processed_files": [], "daily_distances": {}}


def save_stats(stats):
    content = (json.dumps(stats, indent=2, sort_keys=True) + "\n").encode("utf-8")
    write_atomically(Path(STATS_FILE), content)


def get_distance_from_tcx(filepath):
    return tcx_distance(Path(filepath).read_bytes())


def main():
    recover_pending_updates(Path(DATA_DIR))
    stats = load_stats()
    processed_set = set(stats["processed_files"])
    daily_distances = stats.get("daily_distances", {})

    # 扫描数据
    has_updates = False
    for root_dir, dirs, files in os.walk(DATA_DIR):
        for file in files:
            if file.endswith(".tcx"):
                file_path = os.path.join(root_dir, file)
                dist = get_distance_from_tcx(file_path)
                if file in processed_set:
                    continue
                try:
                    parts = file.split("_")
                    date_str = f"{parts[0]}-{parts[1]}-{parts[2]}"
                    datetime.datetime.strptime(date_str, "%Y-%m-%d")
                except Exception:
                    continue

                print(f"Processing: {file}")
                daily_distances[date_str] = daily_distances.get(date_str, 0) + dist
                stats["processed_files"].append(file)
                has_updates = True

    if has_updates:
        stats["daily_distances"] = daily_distances
        save_stats(stats)
        print("Database updated.")

    if not daily_distances:
        print("No data.")
        return

    # === 绘图逻辑 ===
    print("Generating refined GitHub-style heatmap...")

    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=364)

    dates = date_range(start_date, end_date)
    values = [log(daily_distances.get(str(d), 1)) ** 2 for d in dates]

    # 设置字体
    plt.rcParams["font.family"] = "sans-serif"
    plt.rcParams["font.sans-serif"] = ["Arial", "Helvetica", "DejaVu Sans"]

    # 1. 生成基础图表 (移除报错的 edgecolors 参数)
    # ax 是 matplotlib 的 Axes 对象，我们拿到它之后再“魔改”
    ax = july.heatmap(
        dates=dates,
        data=values,
        cmap="github",
        month_grid=False,  # 关掉原本的黑线网格
        horizontal=True,
        value_label=False,
        date_label=False,
        weekday_label=True,
        colorbar=False,
        title=None,
    )

    # 2. === 关键修复：后期添加白色间隙 ===
    # july 生成的热力图本质上是 matplotlib 的 Collections
    # 我们遍历图中的所有集合（方块），给它们手动加上白边
    for collection in ax.collections:
        collection.set_edgecolor("white")  # 白色描边
        collection.set_linewidth(1.5)  # 描边宽度 -> 制造间隙感

    # 3. 保存
    plt.savefig(OUTPUT_IMAGE, dpi=150, bbox_inches="tight", pad_inches=0.1)
    print(f"Heatmap saved to {OUTPUT_IMAGE}")


if __name__ == "__main__":
    main()
