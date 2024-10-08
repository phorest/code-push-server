// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import { Promise } from 'q'
import * as stream from 'stream'
import { v4 as uuidv4 } from 'uuid'


import * as storage from '../script/storage/storage'
import * as restTypes from '../script/types/rest-definitions'

const ACCESS_KEY_EXPIRY = 1000 * 60 * 60 * 24 * 60 // 60 days.

export interface FileProps {
  stream: fs.ReadStream
  size: number
}

export function generateKey(): string {
  return uuidv4() + uuidv4() // The REST API validates that keys must be at least 10 characters long
}

export function makeAccount(): storage.Account {
  const account: storage.Account = {
    createdTime: new Date().getTime(),
    name: 'test account',
    email: 'test_' + uuidv4() + '@email.com',
  }

  return account
}

export function makeStorageAccessKey(): storage.AccessKey {
  const now: number = new Date().getTime()
  const friendlyName: string = uuidv4()
  const name = generateKey()
  const accessKey: storage.AccessKey = {
    name,
    createdTime: now,
    createdBy: 'test machine',
    friendlyName: friendlyName,
    description: friendlyName,
    expires: now + ACCESS_KEY_EXPIRY,
    accessKey: name,
    accountId: '',
  }

  return accessKey
}

export function makeAccessKeyRequest(): restTypes.AccessKeyRequest {
  const accessKeyRequest: restTypes.AccessKeyRequest = {
    name: generateKey(),
    createdBy: 'test machine',
    friendlyName: uuidv4(),
    ttl: ACCESS_KEY_EXPIRY,
  }

  return accessKeyRequest
}

export function makeStorageApp(): storage.App {
  const app: storage.App = {
    createdTime: new Date().getDate(),
    name: uuidv4(),
  }

  return app
}

export function makeRestApp(): restTypes.App {
  const app: restTypes.App = {
    name: uuidv4(),
    deployments: ['Production', 'Staging'],
  }

  return app
}

export function makeStorageDeployment(): storage.Deployment {
  const deployment: storage.Deployment = {
    createdTime: new Date().getDate(),
    name: uuidv4(),
    key: generateKey(),
  }

  return deployment
}

export function makeRestDeployment(): restTypes.Deployment {
  const deployment: restTypes.Deployment = {
    name: uuidv4(),
  }

  return deployment
}

export function makePackage(
  version?: string,
  isMandatory?: boolean,
  packageHash?: string,
  label?: string,
): storage.Package {
  const storagePackage: storage.Package = {
    blobUrl: 'testUrl.com',
    description: 'test blob id',
    isDisabled: false,
    isMandatory: isMandatory || false,
    rollout: null,
    appVersion: version || 'test blob id',
    label: label || null,
    packageHash: packageHash || 'hash123_n',
    size: 1,
    manifestBlobUrl: 'test manifest blob URL',
    uploadTime: new Date().getTime(),
  }

  return storagePackage
}

export function makeStreamFromString(stringValue: string): stream.Readable {
  const blobStream = new stream.Readable()
  blobStream.push(stringValue)
  blobStream.push(null)
  return blobStream
}

export function makeStringFromStream(stream: stream.Readable): Promise<string> {
  let stringValue = ''
  return Promise((resolve: (stringValue: string) => void) => {
    stream
      .on('data', (data: string) => {
        stringValue += data
      })
      .on('end', () => {
        resolve(stringValue)
      })
  })
}

export function getStreamAndSizeForFile(path: string): Promise<FileProps> {
  return Promise((resolve: (props: FileProps) => void, reject: (reason: any) => void) => {
    fs.stat(path, (err: NodeJS.ErrnoException, stats: fs.Stats): void => {
      if (err) {
        reject(err)
        return
      }

      const readable: fs.ReadStream = fs.createReadStream(path)
      resolve({ stream: readable, size: stats.size })
    })
  })
}

export function retrieveStringContentsFromUrl(url: string): Promise<string> {
  let protocol: typeof http | typeof https = null
  if (url.indexOf('https://') === 0) {
    protocol = https
  } else {
    protocol = http
  }

  return Promise((resolve: (stringValue: string) => void) => {
    const requestOptions: https.RequestOptions = {
      path: url,
    }
    protocol
      .get(requestOptions, (response: http.IncomingMessage) => {
        if (response.statusCode !== 200) {
          return null
        }

        makeStringFromStream(response).then((contents: string) => {
          resolve(contents)
        })
      })
      .on('error', (error: any) => {
        resolve(null)
      })
  })
}
