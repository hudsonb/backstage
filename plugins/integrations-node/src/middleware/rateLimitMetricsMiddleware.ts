/*
 * Copyright 2023 The Backstage Authors
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

import { NextFunction, Request, Response } from 'express';
import { AuthService, HttpAuthService } from '@backstage/backend-plugin-api';
import { createGaugeMetric } from '@backstage/integrations-node';

const rateLimitMetric = createGaugeMetric({
  name: 'external_api_rate_limit',
  help: 'The total request rate limit for the external API',
  labelNames: ['invoked_by', 'external_api'] as const,
});

const rateLimitRemainingMetric = createGaugeMetric({
  name: 'external_api_rate_limit_remaining',
  help: 'The remaining requests available for the external API',
  labelNames: ['invoked_by', 'external_api'] as const,
});

const rateLimitResetMetric = createGaugeMetric({
  name: 'external_api_rate_limit_reset',
  help: 'Time until the rate limit resets (in seconds)',
  labelNames: ['invoked_by', 'external_api'] as const,
});

type RateLimitMetricsParams = {
  auth: AuthService;
  httpAuth: HttpAuthService;
  externalApi: string;
  limitHeader?: string;
  remainingHeader?: string;
  resetHeader?: string;
};

export function rateLimitMetricsMiddleware(params: RateLimitMetricsParams) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', async () => {
      const {
        auth,
        httpAuth,
        externalApi,
        limitHeader,
        remainingHeader,
        resetHeader,
      } = params;

      let invokedBy: string | undefined = undefined;
      const credentials = await httpAuth.credentials(req);
      if (auth.isPrincipal(credentials, 'user')) {
        invokedBy = credentials.principal.userEntityRef;
      } else if (auth.isPrincipal(credentials, 'service')) {
        invokedBy = credentials.principal.subject;
      }

      const limit = res.getHeader(limitHeader ?? 'X-RateLimit-Limit');
      const remaining = res.getHeader(
        remainingHeader ?? 'X-RateLimit-Overall-Remaining',
      );
      const reset = res.getHeader(
        resetHeader ?? 'X-External-Api-RateLimit-Reset',
      );

      if (typeof limit === 'string') {
        rateLimitMetric.set(
          {
            invoked_by: invokedBy,
            external_api: externalApi,
          },
          parseInt(limit, 10),
        );
      }
      if (typeof remaining === 'string') {
        rateLimitRemainingMetric.set(
          {
            invoked_by: invokedBy,
            external_api: externalApi,
          },
          parseInt(remaining, 10),
        );
      }
      if (typeof reset === 'string') {
        const resetSeconds =
          parseInt(reset, 10) - Math.floor(Date.now() / 1000);
        rateLimitResetMetric.set(
          {
            invoked_by: invokedBy,
            external_api: externalApi,
          },
          resetSeconds,
        );
      }
    });

    next();
  };
}
