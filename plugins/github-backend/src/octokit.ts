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
import {
  GithubCredentialsProvider,
  ScmIntegrations,
} from '@backstage/integration';
import { LoggerService } from '@backstage/backend-plugin-api';
import { Octokit } from 'octokit';
import { EndpointDefaults } from '@octokit/types';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';

const OctokitClient = Octokit.plugin(retry, throttling);

export async function getOctokit(params: {
  credentialsProvider: GithubCredentialsProvider;
  integrations: ScmIntegrations;
  logger: LoggerService;
  url: string;
}): Promise<Octokit | undefined> {
  const { url, credentialsProvider, integrations, logger } = params;

  try {
    const { token } = await credentialsProvider.getCredentials({ url });
    const integration = integrations.github.byUrl(url);

    return new OctokitClient({
      auth: token,
      baseUrl: integration?.config.apiBaseUrl,
      retry: {
        retries: 3,
        doNotRetry: ['400', '401', '403', '404', '422', '429', '501'],
      },
      throttle: {
        onRateLimit: (
          retryAfter: number,
          options: Required<EndpointDefaults>,
          _octokitInstance: Octokit,
          retryCount: number,
        ): boolean => {
          logger.warn(
            `Primary rate limit exceeded for request ${options.method} ${options.url}. Retrying in ${retryAfter} seconds (retry count: ${retryCount}).`,
          );
          return true;
        },

        onSecondaryRateLimit: (
          retryAfter: number,
          options: Required<EndpointDefaults>,
          _octokitInstance: Octokit,
          retryCount: number,
        ): boolean => {
          logger.warn(
            `Secondary rate limit triggered for request ${options.method} ${options.url}. Retrying in ${retryAfter} seconds (retry count: ${retryCount}).`,
          );
          return true;
        },
      },
    });
  } catch (error) {
    logger.error(`Error creating Octokit for url ${url}: ${error}`);
    return undefined;
  }
}
