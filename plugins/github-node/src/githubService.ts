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
import {
  coreServices,
  createServiceFactory,
  createServiceRef,
} from '@backstage/backend-plugin-api';
import { DiscoveryApi } from '@backstage/core-plugin-api';
import { GithubClient } from '@backstage/github-common';

export interface GithubService {
  forHost(host: string): Promise<Octokit>;
}

class DefaultGithubService implements GithubService {
  readonly client: GithubClient;

  constructor(params: { discovery: DiscoveryApi }) {
    this.client = new GithubClient(params);
  }

  async forHost(url: string): Promise<Octokit> {
    return await this.client.forHost(url);
  }
}

export const githubServiceRef = createServiceRef<GithubService>({
  id: 'github-service',
  defaultFactory: async service =>
    createServiceFactory({
      service,
      deps: {
        discovery: coreServices.discovery,
      },
      async factory({ discovery }) {
        return new DefaultGithubService({
          discovery,
        });
      },
    }),
});
