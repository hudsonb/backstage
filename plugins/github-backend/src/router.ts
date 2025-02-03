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
  AuthService,
  HttpAuthService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { rateLimitMetricsMiddleware } from '@backstage/integrations-node';
import express from 'express';
import {
  DefaultGithubCredentialsProvider,
  ScmIntegrations,
} from '@backstage/integration';
import { InputError } from '@backstage/errors';
import { getOctokit } from './octokit';

export async function createRouter({
  config,
  auth,
  httpAuth,
  logger,
}: {
  config: Config;
  auth: AuthService;
  httpAuth: HttpAuthService;
  logger: LoggerService;
}): Promise<express.Router> {
  const router = express.Router();
  const integrations = ScmIntegrations.fromConfig(config);
  const credentialsProvider =
    DefaultGithubCredentialsProvider.fromIntegrations(integrations);

  router.use(async (req, res) => {
    const { method, originalUrl, body } = req;

    const url = req.headers['github-url'] as string;
    if (!url) {
      throw new InputError('Missing "github-url" header');
    }

    try {
      const octokit = await getOctokit({
        integrations,
        credentialsProvider,
        url,
        logger,
      });

      const response = await octokit.request({
        method,
        url: originalUrl,
        data: body,
      });

      res
        .status(response.status)
        .set(response.headers || {})
        .json(response.data);
    } catch (error: any) {
      logger.error(error);
      res
        .status(error.status || 500)
        .set(error.headers)
        .json({ error: error.message });
    }
  });

  router.use(
    rateLimitMetricsMiddleware({
      auth,
      httpAuth,
      externalApi: 'github',
    }),
  );

  return router;
}
