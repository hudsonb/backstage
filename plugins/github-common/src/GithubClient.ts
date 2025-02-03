/*
 * Copyright 2022 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Octokit } from '@octokit/rest';
import { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';

export class GithubClient {
  readonly #discovery: DiscoveryApi;
  readonly #fetch?: FetchApi;
  readonly #octokitCache = new Map<string, Octokit>();

  constructor(params: { discovery: DiscoveryApi; fetch?: FetchApi }) {
    const { discovery, fetch } = params;
    this.#discovery = discovery;
    this.#fetch = fetch;
  }

  async forHost(host: string): Promise<Octokit> {
    if (this.#octokitCache.has(host)) {
      return this.#octokitCache.get(host)!;
    }

    const baseUrl = await this.#discovery.getBaseUrl('github');
    const octokit = new Octokit({
      baseUrl,
      request: {
        fetch: this.#fetch?.fetch,
        headers: {
          'github-host': host,
        },
      },
      retry: { enabled: false },
      throttle: { enabled: false },
    });

    this.#octokitCache.set(host, octokit);
    return octokit;
  }
}
