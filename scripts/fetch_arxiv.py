#!/usr/bin/env python3
"""
从arXiv API获取论文元数据
用于补全Excel数据中缺失的论文信息
"""
import argparse
import json
import sys
import arxiv
from datetime import datetime


def fetch_paper(arxiv_id):
    """
    获取单篇论文数据

    Args:
        arxiv_id: arXiv论文ID (如 2509.22646v1 或 2509.22646)

    Returns:
        dict: 论文元数据字典

    Raises:
        Exception: 如果获取失败
    """
    try:
        # 初始化arXiv客户端
        client = arxiv.Client()

        # 构建搜索查询
        search = arxiv.Search(
            id_list=[arxiv_id],
            max_results=1
        )

        # 获取第一个结果
        result = next(client.results(search))

        # 提取作者列表
        authors = []
        for author in result.authors:
            authors.append({
                'name': author.name
            })

        # 提取分类列表
        categories = list(result.categories) if result.categories else []

        # 格式化发布日期
        published_date = ''
        if result.published:
            if isinstance(result.published, datetime):
                published_date = result.published.strftime('%Y-%m-%d')
            else:
                published_date = str(result.published).split('T')[0]

        # 构建返回数据
        paper_data = {
            'id': result.entry_id,
            'arxiv_id': result.get_short_id(),
            'title': result.title.strip() if result.title else '',
            'authors': authors,
            'summary': result.summary.strip() if result.summary else '',
            'published': published_date,
            'updated': result.updated.strftime('%Y-%m-%d') if result.updated else '',
            'primary_category': result.primary_category if result.primary_category else '',
            'categories': categories,
            'pdf_url': result.pdf_url if result.pdf_url else '',
            'comment': result.comment if result.comment else '',
            'journal_ref': result.journal_ref if result.journal_ref else '',
            'doi': result.doi if result.doi else ''
        }

        return paper_data

    except StopIteration:
        raise Exception(f"未找到论文: {arxiv_id}")
    except Exception as e:
        raise Exception(f"获取论文失败: {str(e)}")


def main():
    """主函数：解析命令行参数并执行"""
    parser = argparse.ArgumentParser(
        description='从arXiv API获取论文元数据',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例用法:
  python fetch_arxiv.py --arxiv-id 2509.22646v1
  python fetch_arxiv.py --arxiv-id 2509.22646
        """
    )

    parser.add_argument(
        '--arxiv-id',
        required=True,
        help='arXiv论文ID (例如: 2509.22646v1 或 2509.22646)'
    )

    parser.add_argument(
        '--verbose',
        action='store_true',
        help='显示详细日志'
    )

    args = parser.parse_args()

    try:
        if args.verbose:
            print(f"正在获取论文: {args.arxiv_id}", file=sys.stderr)

        # 获取论文数据
        paper_data = fetch_paper(args.arxiv_id)

        if args.verbose:
            print(f"成功获取论文: {paper_data['title']}", file=sys.stderr)

        # 输出JSON格式结果到stdout
        print(json.dumps(paper_data, ensure_ascii=False, indent=2))
        sys.exit(0)

    except Exception as e:
        # 错误信息输出到stderr
        error_data = {
            'error': str(e),
            'arxiv_id': args.arxiv_id
        }
        print(json.dumps(error_data, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
