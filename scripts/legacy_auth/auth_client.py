#!/usr/bin/env python3
"""
Concept2 Logbook API 认证客户端
提供统一的OAuth2认证和token管理功能
"""

import os
import json
import time
import requests
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict

# API 常量
TOKEN_URL = 'https://log.concept2.com/oauth/access_token'
API_BASE = 'https://log.concept2.com/api'
RESULTS_URL = f'{API_BASE}/users/me/results'

# OAuth2 默认scope - 与auth.py保持一致，支持未来扩展
DEFAULT_SCOPE = 'user:read,results:read'

# Token 缓存配置
CACHE_DIR = Path.home() / '.concept2' / 'cache'
CACHE_DIR.mkdir(parents=True, exist_ok=True)
TOKEN_CACHE_FILE = CACHE_DIR / 'tokens.json'


class Concept2AuthClient:
    """Concept2 Logbook API 认证客户端"""

    def __init__(self, client_id: str = None, client_secret: str = None, refresh_token: str = None, access_token: str = None):
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.access_token = access_token
        self.token_expires_at: Optional[datetime] = None

        # 如果提供了access_token直接使用，否则尝试OAuth2流程
        if access_token:
            self.access_token = access_token
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 使用提供的access_token")
        else:
            self._load_cached_token()

    def _load_cached_token(self):
        """从缓存加载token"""
        try:
            if TOKEN_CACHE_FILE.exists():
                with open(TOKEN_CACHE_FILE, 'r') as f:
                    cache = json.load(f)

                # 检查token是否过期（提前5分钟失效）
                expires_at = datetime.fromisoformat(cache['expires_at'])
                if datetime.now() < expires_at - timedelta(minutes=5):
                    self.access_token = cache['access_token']
                    self.token_expires_at = expires_at
                    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 使用缓存的access_token")
                    return True
        except Exception as e:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 缓存加载失败: {e}")

        return False

    def _save_token_cache(self, access_token: str, expires_in: int):
        """保存token到缓存"""
        try:
            self.access_token = access_token
            self.token_expires_at = datetime.now() + timedelta(seconds=expires_in)

            cache = {
                'access_token': access_token,
                'expires_at': self.token_expires_at.isoformat(),
                'cached_at': datetime.now().isoformat()
            }

            with open(TOKEN_CACHE_FILE, 'w') as f:
                json.dump(cache, f, indent=2)

            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Token已缓存，有效期{expires_in}秒")

        except Exception as e:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 缓存保存失败: {e}")

    def refresh_access_token(self, force: bool = False) -> str:
        """
        使用refresh_token获取新的access_token

        Args:
            force: 是否强制刷新，即使缓存的token仍然有效
        """
        # 如果没有OAuth2凭据但有access_token，直接返回
        if not all([self.client_id, self.client_secret, self.refresh_token]):
            if self.access_token:
                return self.access_token
            else:
                raise ValueError("缺少OAuth2凭据或access_token")

        # 如果已有有效token且非强制刷新，直接返回
        if not force and self.access_token and self.token_expires_at:
            if datetime.now() < self.token_expires_at - timedelta(minutes=5):
                return self.access_token

        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 正在刷新access_token...")

        data = {
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'refresh_token': self.refresh_token,
            'grant_type': 'refresh_token'
            # 注意：刷新token时不应指定scope，使用初始授权的scope
        }

        try:
            response = requests.post(TOKEN_URL, data=data)
            response.raise_for_status()

            token_data = response.json()
            access_token = token_data['access_token']
            expires_in = token_data.get('expires_in', 3600)  # 默认1小时

            # 保存到缓存
            self._save_token_cache(access_token, expires_in)

            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Access_token刷新成功")
            return access_token

        except requests.exceptions.RequestException as e:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Token刷新失败: {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 响应状态: {e.response.status_code}")
                if e.response.status_code == 401:
                    print("认证失败，请检查client_id, client_secret和refresh_token是否有效")
                elif e.response.status_code == 400:
                    print("请求参数错误，请检查OAuth2凭据格式")
                elif e.response.status_code == 403:
                    print("访问被禁止，请检查API权限设置")
            raise

    def get_headers(self, force_refresh: bool = False) -> Dict[str, str]:
        """获取API请求头"""
        if not self.access_token or force_refresh:
            self.refresh_access_token(force_refresh)

        return {
            'Authorization': f'Bearer {self.access_token}',
            'Accept': 'application/json',
            'X-Client-Version': '1.0.0'  # 客户端版本标识
        }

    def validate_credentials(self) -> bool:
        """验证凭据是否有效"""
        try:
            headers = self.get_headers()
            # 尝试获取用户信息来验证token
            response = requests.get(f'{API_BASE}/users/me', headers=headers)

            if response.status_code == 200:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ Token验证成功")
                return True
            elif response.status_code == 401:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ Token无效或已过期")
                if self.refresh_token and all([self.client_id, self.client_secret]):
                    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 尝试刷新token...")
                    try:
                        self.refresh_access_token(force=True)
                        # 重新验证
                        headers = self.get_headers()
                        response = requests.get(f'{API_BASE}/users/me', headers=headers)
                        return response.status_code == 200
                    except Exception as e:
                        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Token刷新失败: {e}")
                        return False
                return False
            else:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ API错误: {response.status_code}")
                return False

        except Exception as e:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 凭据验证失败: {e}")
            return False

    def clear_cache(self):
        """清除token缓存"""
        if TOKEN_CACHE_FILE.exists():
            TOKEN_CACHE_FILE.unlink()
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Token缓存已清除")
        self.access_token = None
        self.token_expires_at = None


class Concept2API:
    """Concept2 Logbook API 客户端 - 依赖于认证客户端"""

    def __init__(self, auth_client: Concept2AuthClient):
        self.auth = auth_client

    def download_tcx(self, result_id: int) -> bytes:
        """下载指定结果的TCX文件"""
        tcx_url = f'{RESULTS_URL}/{result_id}/export/tcx'

        response = requests.get(
            tcx_url,
            headers=self.auth.get_headers()
        )
        response.raise_for_status()

        return response.content

    def get_result_metadata(self, result_id: int) -> Optional[Dict]:
        """获取指定结果的元数据"""
        result_url = f'{RESULTS_URL}/{result_id}'

        response = requests.get(
            result_url,
            headers=self.auth.get_headers()
        )
        response.raise_for_status()

        result_data = response.json()
        return result_data.get('data', {})

    def get_all_results(self, per_page: int = 100) -> list:
        """获取所有结果（支持分页）- 使用API的meta.pagination字段"""
        all_results = []
        page = 1
        total_pages = None

        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 开始获取所有结果...")

        while True:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 获取第{page}页数据...")

            params = {
                'page': page,
                'per_page': per_page
            }

            response = requests.get(
                RESULTS_URL,
                headers=self.auth.get_headers(),
                params=params
            )
            response.raise_for_status()

            data = response.json()
            results = data.get('data', [])
            meta = data.get('meta', {})
            pagination = meta.get('pagination', {})

            # 获取分页信息
            current_page = pagination.get('current_page', page)
            total_pages = pagination.get('total_pages', total_pages)
            total_results = pagination.get('total', len(results))

            if not results:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 没有更多数据了")
                break

            all_results.extend(results)
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 第{current_page}页获取到{len(results)}条记录")

            # 根据API文档的meta.pagination信息判断是否有下一页
            if total_pages and current_page >= total_pages:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 已到达最后一页（共{total_pages}页）")
                break

            # 检查是否有下一页链接
            links = pagination.get('links', {})
            next_page_url = links.get('next')
            if not next_page_url and len(results) < per_page:
                # 如果没有下一页链接且当前页数据不足，也认为是最后一页
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 已到达最后一页")
                break

            page += 1
            time.sleep(0.5)  # API友好延迟

        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 总共获取到{len(all_results)}条记录")
        return all_results


def create_api_client(client_id: str = None, client_secret: str = None, refresh_token: str = None, access_token: str = None) -> Concept2API:
    """
    便捷函数：创建API客户端

    Args:
        如果参数为None，则从环境变量读取:
        - C2_CLIENT_ID
        - C2_CLIENT_SECRET
        - C2_REFRESH_TOKEN
        - C2_ACCESS_TOKEN (可选，直接使用access_token)
    """
    # 优先使用提供的access_token
    if access_token:
        auth_client = Concept2AuthClient(access_token=access_token)
        return Concept2API(auth_client)

    # 否则使用OAuth2流程
    if not all([client_id, client_secret, refresh_token]):
        client_id = client_id or os.environ.get('C2_CLIENT_ID')
        client_secret = client_secret or os.environ.get('C2_CLIENT_SECRET')
        refresh_token = refresh_token or os.environ.get('C2_REFRESH_TOKEN')

    if not all([client_id, client_secret, refresh_token]):
        raise ValueError("缺少必要的认证参数，请设置环境变量或提供参数")

    auth_client = Concept2AuthClient(client_id, client_secret, refresh_token)
    return Concept2API(auth_client)


if __name__ == '__main__':
    # 测试认证
    try:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 测试Concept2 API认证...")

        # 尝试从环境变量获取access_token直接测试
        access_token = os.environ.get('C2_ACCESS_TOKEN')
        if access_token:
            api = create_api_client(access_token=access_token)
        else:
            api = create_api_client()

        # 验证凭据
        if api.auth.validate_credentials():
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ 认证成功！")

            # 获取用户基本信息
            response = requests.get(
                f'{API_BASE}/users/me',
                headers=api.auth.get_headers()
            )
            user_data = response.json().get('data', {})
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 用户: {user_data.get('name', 'Unknown')}")
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Token缓存位置: {TOKEN_CACHE_FILE}")
        else:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ 认证失败！")

    except Exception as e:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 错误: {e}")
        exit(1)