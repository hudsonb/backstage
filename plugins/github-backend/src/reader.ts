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
import { GithubService } from '@backstage/github-node';
import { promises as fs } from 'fs';
import { join } from 'path';
import * as os from 'os';
import { minimatch } from 'minimatch';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { NotModifiedError } from '@backstage/errors'; // Ensure you have this dependency installed
import {
  UrlReaderService,
  UrlReaderServiceReadTreeOptions,
  UrlReaderServiceReadTreeResponse,
  UrlReaderServiceReadUrlOptions,
  UrlReaderServiceReadUrlResponse,
  UrlReaderServiceSearchOptions,
  UrlReaderServiceSearchResponse,
} from '@backstage/backend-plugin-api';
import parseGitUrl from 'git-url-parse';

export class GitHubUrlReader implements UrlReaderService {
  readonly #github: GithubService;

  constructor(github: GithubService) {
    this.#github = github;
  }

  private parseGithubUrl(url: string): {
    host: string;
    owner: string;
    repo: string;
    path: string;
    ref?: string;
  } {
    const parsed = parseGitUrl(url);

    if (!parsed.source) {
      throw new Error(`Invalid Git URL: ${url}`);
    }

    return {
      host: parsed.source,
      owner: parsed.owner,
      repo: parsed.name,
      path: parsed.filepath || '',
      ref: parsed.ref || 'main',
    };
  }

  /**
   * Implements the readUrl method to fetch the content of a single file.
   */
  async readUrl(
    url: string,
    options?: UrlReaderServiceReadUrlOptions,
  ): Promise<UrlReaderServiceReadUrlResponse> {
    const { owner, repo, path, ref, host } = this.parseGithubUrl(url);

    const client = await this.#github.forHost(host);

    try {
      const response = await client.repos.getContent({
        owner,
        repo,
        path,
        ref,
        headers: {
          ...(options?.etag ? { 'If-None-Match': options.etag } : {}),
        },
      });

      if (!('content' in response.data)) {
        throw new Error(`Expected file but got a directory: ${url}`);
      }

      if (response.data.encoding !== 'base64') {
        throw new Error(`Unsupported encoding: ${response.data.encoding}`);
      }

      const buffer = Buffer.from(response.data.content, 'base64');

      return {
        buffer: async () => buffer,
        etag: response.headers.etag,
        lastModifiedAt: response.headers['last-modified']
          ? new Date(response.headers['last-modified'])
          : undefined,
      };
    } catch (error: any) {
      if (error.status === 304) {
        throw new NotModifiedError();
      }
      throw error;
    }
  }

  /**
   * Implements the readTree method to fetch an entire directory or repository tree.
   */
  async readTree(
    url: string,
    _options?: UrlReaderServiceReadTreeOptions,
  ): Promise<UrlReaderServiceReadTreeResponse> {
    const { owner, repo, ref, path, host } = this.parseGithubUrl(url);

    const client = await this.#github.forHost(host);

    const response = await client.git.getTree({
      owner,
      repo,
      tree_sha: ref || 'main',
      recursive: 'true',
    });

    const files = response.data.tree.filter(
      item => item.type === 'blob' && (!path || item.path?.startsWith(path)),
    );

    const tempDir = await fs.mkdtemp(join(os.tmpdir(), 'url-reader-'));

    await Promise.all(
      files.map(async file => {
        const fileResponse = await client.repos.getContent({
          owner,
          repo,
          path: file.path!,
          ref,
        });

        if (!('content' in fileResponse.data)) {
          return;
        }

        if (fileResponse.data.encoding !== 'base64') {
          throw new Error(
            `Unsupported encoding: ${fileResponse.data.encoding}`,
          );
        }

        const fileBuffer = Buffer.from(
          fileResponse.data.content,
          fileResponse.data.encoding,
        );
        const localPath = join(tempDir, file.path!);
        await fs.mkdir(join(localPath, '..'), { recursive: true });
        await fs.writeFile(localPath, fileBuffer);
      }),
    );

    return {
      files: async () =>
        files.map(file => ({
          path: file.path!,
          content: async () => fs.readFile(join(tempDir, file.path!)),
        })),
      archive: async () => {
        const archivePath = join(tempDir, 'archive.tar.gz');
        await pipeline(
          createReadStream(tempDir),
          createWriteStream(archivePath),
        );
        return createReadStream(archivePath);
      },
      dir: async () => tempDir,
      etag: response.headers.etag!,
    };
  }

  /**
   * Implements the search method to search for files in a repository based on a glob pattern.
   */
  async search(
    url: string,
    _options?: UrlReaderServiceSearchOptions,
  ): Promise<UrlReaderServiceSearchResponse> {
    const { owner, repo, ref, path, host } = this.parseGithubUrl(url);

    const client = await this.#github.forHost(host);

    const response = await client.git.getTree({
      owner,
      repo,
      tree_sha: ref || 'main',
      recursive: 'true',
    });

    const files = response.data.tree.filter(
      item => item.type === 'blob' && minimatch(item.path!, path || '**'),
    );

    return {
      files: await Promise.all(
        files.map(async file => ({
          url: `https://github.com/${owner}/${repo}/blob/${ref}/${file.path}`,
          content: async () => {
            const fileResponse = await client.repos.getContent({
              owner,
              repo,
              path: file.path!,
              ref,
            });

            if (!('content' in fileResponse.data)) {
              throw new Error(`Expected file but got directory: ${file.path}`);
            }

            if (fileResponse.data.encoding !== 'base64') {
              throw new Error(
                `Unsupported encoding: ${fileResponse.data.encoding}`,
              );
            }

            return Buffer.from(
              fileResponse.data.content,
              fileResponse.data.encoding,
            );
          },
        })),
      ),
      etag: response.headers.etag!,
    };
  }
}
