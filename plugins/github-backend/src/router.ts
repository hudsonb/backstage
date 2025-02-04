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
  router.use(express.json());

  const integrations = ScmIntegrations.fromConfig(config);
  const credentialsProvider =
    DefaultGithubCredentialsProvider.fromIntegrations(integrations);

  router.use(async (req, res) => {
    const { method, originalUrl, body } = req;

    // logger.info(`github backend received request: method=${method}, url=${originalUrl}, headers=${JSON.stringify(req.headers)}, body=${JSON.stringify(body)}`);
    const url = req.headers['github-host'] as string;
    if (!url) {
      throw new InputError('Missing "github-host" header');
    }

    try {
      const octokit = await getOctokit({
        integrations,
        credentialsProvider,
        url,
        logger,
      });

      if (!octokit) {
        throw new Error(`Failed to create Octokit instance for ${url}`);
      }

      const updatedUrl = originalUrl.replace('/api/github', '');

      // logger.info(`Making ${method} request to ${updatedUrl} with body ${JSON.stringify(body)}`);
      const response = await octokit.request({
        method,
        url: updatedUrl,
        data: body,
      });

      // logger.info(`Octokit response is ${response.status} ${JSON.stringify(response.headers)} ${JSON.stringify(response.data)}`);

      const filteredHeaders = { ...response.headers };
      delete filteredHeaders['transfer-encoding'];
      delete filteredHeaders['content-encoding'];
      filteredHeaders['content-type'] = 'application/json';

      res.writeHead(response.status, filteredHeaders);
      res.end(JSON.stringify(response.data));

      // logger.info(`Sending response with headers ${JSON.stringify(res.getHeaders())}`);

      // logger.info(`Responded to ${method} request to ${originalUrl} with ${JSON.stringify(response)}`);
    } catch (error: any) {
      logger.error(error);
      res.status(error.status || 500).json({ error: error.message });
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
