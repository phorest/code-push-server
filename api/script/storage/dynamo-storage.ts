import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  clone,
  App,
  Account,
  Deployment,
  ErrorCode,
  Package,
  storageError,
  AccessKey,
  CollaboratorMap,
  CollaboratorProperties,
  Permissions,
  Storage, DeploymentInfo,
} from './storage'
import * as q from 'q'
import { Promise } from 'q'
import { Readable } from 'stream'
import { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { v4 as uuidv4 } from 'uuid';

export class DynamoStorage implements Storage {
  private _dynamoClient: DynamoDBClient
  private _setupPromise: q.Promise<void>

  public constructor() {
    this._setupPromise = this.setup()
  }

  private setup(): q.Promise<void> {
    const createDynamoClient = () => {
      this._dynamoClient = new DynamoDBClient({
        region: 'eu-west-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      })
    }

    return q.all([createDynamoClient()]).catch(() => {
      throw storageError(ErrorCode.ConnectionFailed, 'Dynamo client initialization failed')
    })
  }

  checkHealth(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  addAccount(account: Account): Promise<string> {
    return this._setupPromise
      .then(async () => {
        account = clone(account) // pass by value
        account.id = uuidv4()
        await this._dynamoClient.send(
          new PutCommand({
            TableName: 'code-push-accounts',
            Item: account,
          }),
        )
        return account.id
      })
      .catch(() => {
        throw storageError(ErrorCode.AlreadyExists, 'Account already exists')
      })
  }

  getAccount(accountId: string): Promise<Account> {
    return this._setupPromise.then(async () => {
      const response = await this._dynamoClient.send(
        new QueryCommand({
          TableName: 'code-push-accounts',
          IndexName: 'id-index',
          KeyConditionExpression: '#id = :id',
          ExpressionAttributeNames: {
            '#id': 'id',
          },
          ExpressionAttributeValues: {
            ':id': accountId,
          },
        }),
      )
      if (response.Items) {
        return response.Items[0] as Account
      } else {
        throw storageError(ErrorCode.NotFound, 'Account not found')
      }
    })
  }

  getAccountByEmail(email: string): Promise<Account> {
    return this._setupPromise.then(async () => {
      const response = await this._dynamoClient.send(
        new GetCommand({
          TableName: 'code-push-accounts',
          Key: {
            email: email,
          },
        }),
      )
      if (response.Item) {
        return response.Item as Account
      } else {
        throw storageError(ErrorCode.NotFound, 'Account not found')
      }
    })
  }

  getAccountIdFromAccessKey(accessKey: string): Promise<string> {
    return this._setupPromise
      .then(async () => {
        const response = await this._dynamoClient.send(
          new GetCommand({
            TableName: 'code-push-access-keys',
            Key: {
              accessKey,
            },
          }),
        )
        if (response.Item) {
          return response.Item.accountId
        }
      })
      .catch(() => {
        throw storageError(ErrorCode.NotFound, 'Access key not found')
      })
  }

  updateAccount(email: string, updates: Account): Promise<void> {
    throw new Error('Method not implemented.')
  }

  addApp(accountId: string, app: App): Promise<App> {
    return this._setupPromise
      .then(async () => {
        app = clone(app) // pass by value
        app.id = uuidv4()
        app.accountId = accountId
        app.deployments = []

        const account = await this.getAccount(accountId)

        const collaboratorMap: CollaboratorMap = {}
        collaboratorMap[account.email] = {
          accountId: accountId,
          permission: Permissions.Owner,
          isCurrentAccount: true,
        } as CollaboratorProperties

        app.collaborators = collaboratorMap
        await this._dynamoClient.send(
          new PutCommand({
            TableName: 'code-push-apps',
            Item: app,
          }),
        )
        return app
      })
      .catch(() => {
        throw storageError(ErrorCode.AlreadyExists, 'App already exists')
      })
  }

  getApps(accountId: string): Promise<App[]> {
    return this._setupPromise
      .then(async () => {
        const response = await this._dynamoClient.send(
          new QueryCommand({
            TableName: 'code-push-apps',
            IndexName: 'accountId-index',
            KeyConditionExpression: '#accountId = :accountId',
            ExpressionAttributeNames: {
              '#accountId': 'accountId',
            },
            ExpressionAttributeValues: {
              ':accountId': accountId,
            },
          }),
        )
        if (response.Items) {
          return response.Items as App[]
        } else {
          throw storageError(ErrorCode.Other, 'Could not get apps')
        }
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not get apps')
      })
  }

  getApp(accountId: string, appId: string): Promise<App> {
    return this._setupPromise
      .then(async () => {
        const apps = await this.getApps(accountId)
        return apps.find((app) => app.id === appId)
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not get app')
      })
  }

  removeApp(accountId: string, appId: string): Promise<void> {
    return this._setupPromise
      .then(async () => {
        await this._dynamoClient.send(
          new DeleteCommand({
            TableName: 'code-push-apps',
            Key: {
              id: appId,
            },
          }),
        )
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not delete app')
      })
  }

  transferApp(accountId: string, appId: string, email: string): Promise<void> {
    throw new Error('Method not implemented.')
  }

  updateApp(accountId: string, app: App): Promise<void> {
    throw new Error('Method not implemented.')
  }

  addCollaborator(accountId: string, appId: string, email: string): Promise<void> {
    return this._setupPromise
      .then(async () => {
        const app = await this.getApp(accountId, appId)
        const account = await this.getAccountByEmail(email)
        const collaboratorMap: CollaboratorMap = {
          ...app.collaborators,
        }
        collaboratorMap[email] = {
          accountId: account.id,
          permission: Permissions.Owner,
          isCurrentAccount: true,
        } as CollaboratorProperties

        await this._dynamoClient.send(
          new UpdateCommand({
            TableName: 'code-push-apps',
            Key: {
              id: app.id,
            },
            UpdateExpression: 'set collaborators = :collaborator',
            ExpressionAttributeValues: {
              ':collaborator': collaboratorMap,
            },
            ReturnValues: 'ALL_NEW',
          }),
        )
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not add collaborators')
      })
  }

  getCollaborators(accountId: string, appId: string): Promise<CollaboratorMap> {
    return this._setupPromise
      .then(async () => {
        const apps = await this.getApps(accountId)
        return apps.find((app) => app.id === appId).collaborators
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not get collaborators')
      })
  }

  removeCollaborator(accountId: string, appId: string, email: string): Promise<void> {
    throw new Error('Method not implemented.')
  }

  addDeployment(accountId: string, appId: string, deployment: Deployment): Promise<string> {
    return this._setupPromise
      .then(async () => {
        const app = await this.getApp(accountId, appId)
        deployment = clone(deployment)
        deployment.id = uuidv4()
        await this._dynamoClient.send(
          new UpdateCommand({
            TableName: 'code-push-apps',
            Key: {
              id: app.id,
            },
            UpdateExpression: 'set deployments = list_append(deployments, :deployment)',
            ExpressionAttributeValues: {
              ':deployment': [deployment],
            },
            ReturnValues: 'ALL_NEW',
          }),
        )
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not add deployment')
      })
  }

  getDeployment(
    accountId: string,
    appId: string,
    deploymentId: string,
  ): Promise<Deployment> {
    return this._setupPromise
      .then(async () => {
        const deployments = await this.getDeployments(accountId, appId)
        return deployments.find((deployment) => deployment.id === deploymentId)
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not get deployment')
      })
  }

  getDeploymentInfo(deploymentKey: string): Promise<DeploymentInfo> {
    throw new Error('Method not implemented.')
  }

  getDeployments(accountId: string, appId: string): Promise<Deployment[]> {
    return this._setupPromise.then(async () => {
      const response = await this._dynamoClient.send(
        new GetCommand({
          TableName: 'code-push-apps',
          Key: {
            id: appId,
          },
        }),
      )
      if (response.Item) {
        return response.Item.deployments as Deployment[]
      } else {
        throw storageError(ErrorCode.NotFound, 'Deployment not found')
      }
    })
  }

  removeDeployment(accountId: string, appId: string, deploymentId: string): Promise<void> {
    return this._setupPromise
      .then(async () => {
        const deployments = await this.getDeployments(accountId, appId)
        const newDeployments = deployments.filter((deployment) => deployment.id !== deploymentId)
        await this._dynamoClient.send(
          new UpdateCommand({
            TableName: 'code-push-apps',
            Key: {
              id: appId,
            },
            UpdateExpression: 'set deployments = :deployment',
            ExpressionAttributeValues: {
              ':deployment': newDeployments,
            },
            ReturnValues: 'ALL_NEW',
          }),
        )
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not delete deployment')
      })
  }

  updateDeployment(
    accountId: string,
    appId: string,
    deployment: Deployment,
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

  commitPackage(
    accountId: string,
    appId: string,
    deploymentId: string,
    appPackage: Package,
  ): Promise<Package> {
    throw new Error('Method not implemented.')
  }

  clearPackageHistory(accountId: string, appId: string, deploymentId: string): Promise<void> {
    throw new Error('Method not implemented.')
  }

  getPackageHistoryFromDeploymentKey(deploymentKey: string): Promise<Package[]> {
    throw new Error('Method not implemented.')
  }

  getPackageHistory(
    accountId: string,
    appId: string,
    deploymentId: string,
  ): Promise<Package[]> {
    throw new Error('Method not implemented.')
  }

  updatePackageHistory(
    accountId: string,
    appId: string,
    deploymentId: string,
    history: Package[],
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

  addBlob(blobId: string, addstream: Readable, streamLength: number): Promise<string> {
    throw new Error('Method not implemented.')
  }

  getBlobUrl(blobId: string): Promise<string> {
    throw new Error('Method not implemented.')
  }

  removeBlob(blobId: string): Promise<void> {
    throw new Error('Method not implemented.')
  }

  addAccessKey(accountId: string, accessKey: AccessKey): Promise<string> {
    return this._setupPromise
      .then(async () => {
        const response = await this._dynamoClient.send(
          new QueryCommand({
            TableName: 'code-push-accounts',
            IndexName: 'id-index',
            KeyConditionExpression: '#id = :id',
            ExpressionAttributeNames: {
              '#id': 'id',
            },
            ExpressionAttributeValues: {
              ':id': accountId,
            },
          }),
        )

        await this._dynamoClient.send(
          new UpdateCommand({
            TableName: 'code-push-accounts',
            Key: {
              email: response.Items[0].email,
            },
            UpdateExpression: 'set #accessKey = :accessKey',
            ExpressionAttributeNames: {
              '#accessKey': 'accessKey',
            },
            ExpressionAttributeValues: {
              ':accessKey': accessKey.name,
            },
            ReturnValues: 'ALL_NEW',
          }),
        )

        let newAccessKey = clone(accessKey)
        newAccessKey = { ...newAccessKey, accessKey: accessKey.name, id: uuidv4(), accountId }
        await this._dynamoClient.send(
          new PutCommand({
            TableName: 'code-push-access-keys',
            Item: newAccessKey,
          }),
        )
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not add access key')
      })
  }

  getAccessKey(
    accountId: string,
    accessKeyId: string,
  ): Promise<AccessKey> {
    return this._setupPromise
      .then(async () => {
        const response = await this._dynamoClient.send(
          new QueryCommand({
            TableName: 'code-push-access-keys',
            IndexName: 'accountId-index',
            KeyConditionExpression: 'accountId = :accountId',
            ExpressionAttributeValues: {
              ':accountId': accountId,
            },
          }),
        )
        return response.Items[0]
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not get access key')
      })
  }

  getAccessKeys(accountId: string): Promise<AccessKey[]> {
    return this._setupPromise
      .then(async () => {
        const accessKey = await this.getAccessKey(accountId, '')
        return [accessKey]
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not get access keys')
      })
  }

  removeAccessKey(accountId: string, accessKeyId: string): Promise<void> {
    return this._setupPromise
      .then(async () => {
        await this._dynamoClient.send(
          new DeleteCommand({
            TableName: 'code-push-access-keys',
            Key: {
              accessKey: accessKeyId,
            },
          }),
        )
      })
      .catch(() => {
        throw storageError(ErrorCode.Other, 'Could not delete access key')
      })
  }

  updateAccessKey(accountId: string, accessKey: AccessKey): Promise<void> {
    throw new Error('Method not implemented.')
  }

  dropAll(): Promise<void> {
    throw new Error('Method not implemented.')
  }
}
