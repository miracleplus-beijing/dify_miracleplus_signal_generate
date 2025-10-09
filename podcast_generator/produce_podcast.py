# -*- coding: utf-8 -*-
"""
播客音频生成脚本
从播客稿markdown文件生成语音，使用SiliconFlow TTS API
支持上传到Supabase Storage并更新数据库
"""
import os
import sys
import json
import re
import argparse
from pathlib import Path
from openai import OpenAI
import time
from datetime import datetime
from typing import List, Dict, Tuple, Optional

# ==================== 环境变量加载 ====================
def load_env_file(env_path):
    """手动加载.env文件"""
    if not os.path.exists(env_path):
        print(f"[WARN] 警告: 未找到.env文件: {env_path}")
        return

    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ[key] = value

# 加载根目录的.env文件
script_dir = Path(__file__).parent
project_root = script_dir.parent
env_path = project_root / '.env'
load_env_file(str(env_path))

# 从环境变量读取API配置
API_KEY = os.getenv('SILICONFLOW_API_KEY', '')
BASE_URL = os.getenv('SILICONFLOW_BASE_URL', 'https://api.siliconflow.cn/v1')

if not API_KEY:
    print("[ERROR] 错误: 未找到SILICONFLOW_API_KEY环境变量")
    print("        请在.env文件中配置: SILICONFLOW_API_KEY=your_api_key")
    sys.exit(1)

# ==================== API客户端初始化 ====================
client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

# ==================== 音色参考配置 ====================
def load_voice_references():
    """加载音色参考文件"""
    references = []

    # 女声参考
    female_base64_path = script_dir / 'female_base64.txt'
    if female_base64_path.exists():
        with open(female_base64_path, 'r', encoding='utf-8') as f:
            female_base64 = f.read().strip()
            references.append({
                "audio": f"data:audio/mpeg;base64,{female_base64}",
                "text": "周一到周五，每天早晨七点半到九点半的直播片段。言下之意呢，就是废话有点多，大家也别嫌弃，因为这都是直播间最真实的状态了。"
            })
    else:
        print(f"[WARN] 警告: 未找到女声参考文件: {female_base64_path}")

    # 男声参考
    male_base64_path = script_dir / 'male_base64.txt'
    if male_base64_path.exists():
        with open(male_base64_path, 'r', encoding='utf-8') as f:
            male_base64 = f.read().strip()
            references.append({
                "audio": f"data:audio/mpeg;base64,{male_base64}",
                "text": "就现在的影片结尾是这个凯瑟琳和杰西卡一番折腾以后呢，那个网红的摄像机碎了，然后两个人要消失了。然后杰西卡说：这下大家都要消失，你高兴了吧。"
            })
    else:
        print(f"[WARN] 警告: 未找到男声参考文件: {male_base64_path}")

    if not references:
        print("[ERROR] 错误: 未找到任何音色参考文件")
        sys.exit(1)

    return references

# ==================== 脚本解析 ====================
def load_arxiv_mapping(output_dir):
    """
    加载arXiv ID映射文件

    Args:
        output_dir: 输出目录

    Returns:
        dict: arXiv ID映射字典
    """
    mapping_file = Path(output_dir) / 'arxiv_mapping.json'

    if not mapping_file.exists():
        print(f"[WARN] 未找到arXiv映射文件: {mapping_file}")
        return {}

    try:
        with open(mapping_file, 'r', encoding='utf-8') as f:
            mapping = json.load(f)
            print(f"[Mapping] 加载了 {len(mapping)} 个arXiv ID映射")
            return mapping
    except Exception as e:
        print(f"[ERROR] 读取arXiv映射文件失败: {e}")
        return {}


def parse_podcast_script(script_path, arxiv_id_override=None, arxiv_mapping=None):
    """
    解析播客稿文件（支持Markdown和JSON格式）

    支持格式:
    1. Markdown格式: 纯文本脚本（Dify生成的格式）
       [S1]文本...[S2]文本...
    2. JSON字符串数组: ["[S1]文本...[S2]文本...", ...]
    3. JSON字典数组: [{"title": "标题", "script": "[S1]文本..."}, ...]
    4. 完整JSON格式: [{"title": "...", "script": "...", "arxiv_id": "...", "channel_id": "..."}, ...]

    Args:
        script_path: 脚本文件路径
        arxiv_id_override: 强制指定的arXiv ID（用于markdown格式）
        arxiv_mapping: arXiv ID映射字典

    Returns:
        List[Dict]: [{"title": "标题", "script": "脚本", "arxiv_id": "...", "channel_id": "..."}, ...]
    """
    if not os.path.exists(script_path):
        print(f"[ERROR] 错误: 脚本文件不存在: {script_path}")
        sys.exit(1)

    arxiv_mapping = arxiv_mapping or {}

    try:
        with open(script_path, 'r', encoding='utf-8') as f:
            content = f.read().strip()

        # 尝试解析为JSON
        is_json = False
        segments = None

        try:
            segments = json.loads(content)
            is_json = True
            if not isinstance(segments, list):
                raise ValueError("JSON内容不是数组格式")
        except (json.JSONDecodeError, ValueError):
            # 不是JSON格式，当作Markdown文本处理
            is_json = False

        parsed_segments = []

        if is_json:
            # JSON格式处理
            print(f"[Parse] 检测到JSON格式脚本")
            for idx, item in enumerate(segments):
                if isinstance(item, dict):
                    # 字典格式
                    title = item.get('title', f'segment_{idx}')
                    script = item.get('script', '')
                    arxiv_id = item.get('arxiv_id', arxiv_id_override or f'unknown_{idx}')
                    channel_id = item.get('channel_id', '')

                    # 尝试从映射中获取真实的arXiv ID
                    if arxiv_id.startswith('unknown_') or arxiv_id.startswith('segment_'):
                        # 尝试从标题匹配
                        clean_title = title.replace(' ', '_')[:50]
                        if clean_title in arxiv_mapping:
                            arxiv_id = arxiv_mapping[clean_title]
                            print(f"[Mapping] 从标题匹配到arXiv ID: {title} -> {arxiv_id}")
                        elif f'paper_{idx}' in arxiv_mapping:
                            arxiv_id = arxiv_mapping[f'paper_{idx}']
                            print(f"[Mapping] 从索引匹配到arXiv ID: paper_{idx} -> {arxiv_id}")

                    if not script:
                        print(f"[WARN] 警告: 段落 {idx} 的 script 字段为空")

                    parsed_segments.append({
                        "title": title,
                        "script": script,
                        "arxiv_id": arxiv_id,
                        "channel_id": channel_id
                    })
                elif isinstance(item, str):
                    # 字符串格式
                    arxiv_id = arxiv_id_override or f'unknown_{idx}'

                    # 尝试从映射获取
                    if f'paper_{idx}' in arxiv_mapping:
                        arxiv_id = arxiv_mapping[f'paper_{idx}']
                        print(f"[Mapping] 从索引匹配到arXiv ID: paper_{idx} -> {arxiv_id}")

                    parsed_segments.append({
                        "title": f'segment_{idx}',
                        "script": item,
                        "arxiv_id": arxiv_id,
                        "channel_id": ''
                    })
                else:
                    raise ValueError(f"不支持的段落格式 (索引 {idx}): {type(item)}")

        else:
            # Markdown文本格式处理
            print(f"[Parse] 检测到Markdown文本格式")

            # 从文件名提取arXiv ID（如果没有override）
            if not arxiv_id_override:
                filename = os.path.basename(script_path)

                # 首先尝试从映射文件获取（使用paper_0，因为单个文件通常对应第一条记录）
                if 'paper_0' in arxiv_mapping:
                    arxiv_id_override = arxiv_mapping['paper_0']
                    print(f"[Mapping] 使用映射文件中的arXiv ID: {arxiv_id_override}")
                else:
                    # 尝试从文件名提取时间戳作为ID
                    import re
                    timestamp_match = re.search(r'(\d{4}-\d{2}-\d{2}[- ]\d{2}-\d{2}-\d{2})', filename)
                    if timestamp_match:
                        arxiv_id_override = timestamp_match.group(1).replace(' ', '-')
                    else:
                        arxiv_id_override = f'podcast_{int(time.time())}'

            # 整个文件作为单个脚本
            parsed_segments.append({
                "title": os.path.splitext(os.path.basename(script_path))[0],
                "script": content,
                "arxiv_id": arxiv_id_override,
                "channel_id": ''
            })

        print(f"[Parse] 解析到 {len(parsed_segments)} 个播客段落")
        return parsed_segments

    except Exception as e:
        print(f"[ERROR] 错误: 读取脚本文件失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

# ==================== 音频生成 ====================
def generate_audio(text, references, output_path, verbose=False):
    """生成单个音频文件"""
    try:
        params = dict(
            model="fnlp/MOSS-TTSD-v0.5",
            input=text,
            response_format="mp3",
            voice="",
            extra_body={
                "references": references,
                "max_tokens": 16384,
            }
        )

        if verbose:
            print(f"   [Gen] 正在生成: {output_path.name}")

        with client.audio.speech.with_streaming_response.create(**params) as response:
            data = response.read()
            with open(output_path, "wb") as f:
                f.write(data)

        return True

    except Exception as e:
        print(f"[ERROR] 生成失败: {e}")
        return False

# ==================== 上传功能已移至Backend ====================
# Python脚本只负责生成音频文件，上传由Node.js Backend处理

# ==================== 主函数 ====================
def main():
    parser = argparse.ArgumentParser(
        description='播客音频生成工具 - 从播客稿生成语音并上传',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例用法:
  # 仅生成音频（不上传）
  python produce_podcast.py --script ../outputs/2025/10/05/podcast.md --output-dir ../outputs/2025/10/05

  # 生成音频并上传到Supabase
  python produce_podcast.py --script podcast.md --output-dir ./output --channel-id 355ed9b9-58d6-4716-a542-cadc13ae8ef4 --upload

  # 详细日志模式
  python produce_podcast.py --script podcast.md --output-dir ./output --upload --verbose
        """
    )

    parser.add_argument('--script', required=True, help='播客稿文件路径（支持Markdown和JSON格式）')
    parser.add_argument('--output-dir', required=True, help='音频输出目录')
    parser.add_argument('--channel-id', help='频道ID（用于记录）')
    parser.add_argument('--verbose', action='store_true', help='显示详细日志')
    parser.add_argument('--check-only', action='store_true', help='仅检查配置，不生成音频')

    args = parser.parse_args()

    # 检查配置
    print("=" * 60)
    print("[TTS] 播客音频生成工具")
    print("=" * 60)
    print(f"[Script] 脚本文件: {args.script}")
    print(f"[Dir] 输出目录: {args.output_dir}")
    print(f"[API] API URL: {BASE_URL}")
    print(f"[API] API Key: {API_KEY[:20]}..." if len(API_KEY) > 20 else f"[API] API Key: {API_KEY}")
    print("=" * 60)

    if args.check_only:
        print("[OK] 配置检查完成（--check-only模式）")
        return

    # 创建输出目录
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # 加载音色参考
    print("[Load] 加载音色参考文件...")
    references = load_voice_references()
    print(f"[OK] 加载了 {len(references)} 个音色参考")

    # 加载arXiv ID映射文件
    print("\n[Mapping] 加载arXiv ID映射文件...")
    arxiv_mapping = load_arxiv_mapping(args.output_dir)

    # 解析播客稿
    print(f"\n[Read] 解析播客稿: {args.script}")

    segments = parse_podcast_script(args.script, arxiv_id_override=None, arxiv_mapping=arxiv_mapping)

    # 生成音频
    print(f"\n[Audio] 开始生成 {len(segments)} 个音频文件...")
    start_time = time.time()

    success_count = 0
    failed_count = 0
    generated_files = []  # 记录生成的文件信息

    for idx, segment_info in enumerate(segments):
        title = segment_info['title']
        script = segment_info['script']
        arxiv_id = segment_info['arxiv_id']
        channel_id = segment_info['channel_id']

        # 使用 arXiv ID 作为文件名
        output_filename = f"{arxiv_id}.mp3"
        output_path = output_dir / output_filename

        if args.verbose:
            print(f"\n[{idx + 1}/{len(segments)}]")
            print(f"   标题: {title}")
            print(f"   arXiv ID: {arxiv_id}")
            print(f"   文本长度: {len(script)} 字符")

        if generate_audio(script, references, output_path, args.verbose):
            success_count += 1
            generated_files.append({
                "local_path": str(output_path),
                "arxiv_id": arxiv_id,
                "channel_id": channel_id or args.channel_id
            })
            print(f"[OK] [{idx + 1}/{len(segments)}] {arxiv_id} - {title[:40]}{'...' if len(title) > 40 else ''}")
            print(f"     输出文件: {output_path.name}")
        else:
            failed_count += 1
            print(f"[ERROR] [{idx + 1}/{len(segments)}] 生成失败: {arxiv_id}")

    # 统计信息
    end_time = time.time()
    elapsed = end_time - start_time

    print("\n" + "=" * 60)
    print("[Stats] 生成完成统计")
    print("=" * 60)
    print(f"[OK] 成功: {success_count} 个")
    print(f"[ERROR] 失败: {failed_count} 个")
    print(f"[Time] 总耗时: {elapsed:.2f} 秒")
    print(f"[Dir] 输出目录: {output_dir}")
    print("=" * 60)

    # 输出结果JSON（供Backend调用）
    result_json = {
        "success": success_count,
        "failed": failed_count,
        "elapsed_time": elapsed,
        "files": generated_files
    }

    # 保存结果到文件
    result_file = output_dir / "audio_generation_result.json"
    with open(result_file, 'w', encoding='utf-8') as f:
        json.dump(result_json, f, ensure_ascii=False, indent=2)

    print(f"\n[Result] 结果已保存: {result_file}")

    if failed_count > 0:
        sys.exit(1)

if __name__ == "__main__":
    main()
