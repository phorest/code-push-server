import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import * as storage from "./storage";
import { ErrorCode } from "./storage";
import * as q from "q";
import { Promise } from "q";
import { Readable } from "stream";
import { generate } from "shortid";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

export class DynamoStorage implements storage.Storage {
  private _dynamoClient: DynamoDBClient;
  private _setupPromise: q.Promise<void>;

  public constructor() {
    this._setupPromise = this.setup();
  }

  private setup(): q.Promise<void> {
    const createDynamoClient = () => {
      this._dynamoClient = new DynamoDBClient({
        region: "eu-west-1",
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });
    };

    return q.all([createDynamoClient()]).catch((e) => {
      throw storage.storageError(
        ErrorCode.ConnectionFailed,
        "Dynamo Client initialization failed"
      );
    });
  }

  checkHealth(): Promise<void> {
    throw new Error("Method not implemented.");
  }

  addAccount(account: storage.Account): Promise<string> {
    return this._setupPromise
      .then(async () => {
        account = storage.clone(account); // pass by value
        account.id = generate();
        await this._dynamoClient.send(
          new PutCommand({
            TableName: "code-push-accounts",
            Item: account,
          })
        );
        return account.id;
      })
      .catch(() => {
        throw storage.storageError(
          ErrorCode.AlreadyExists,
          "Account already exists"
        );
      });
  }

  getAccount(accountId: string): Promise<storage.Account> {
    return this._setupPromise.then(async () => {
      const response = await this._dynamoClient.send(
        new QueryCommand({
          TableName: "code-push-accounts",
          IndexName: "id-index",
          KeyConditionExpression: "#id = :id",
          ExpressionAttributeNames: {
            "#id": "id",
          },
          ExpressionAttributeValues: {
            ":id": accountId,
          },
        })
      );
      if (response.Items) {
        return response.Items[0] as storage.Account;
      } else {
        throw storage.storageError(ErrorCode.NotFound, "Account not found");
      }
    });
  }

  getAccountByEmail(email: string): Promise<storage.Account> {
    return this._setupPromise.then(async () => {
      const response = await this._dynamoClient.send(
        new GetCommand({
          TableName: "code-push-accounts",
          Key: {
            email: email,
          },
        })
      );
      if (response.Item) {
        return response.Item as storage.Account;
      } else {
        throw storage.storageError(ErrorCode.NotFound, "Account not found");
      }
    });
  }

  getAccountIdFromAccessKey(accessKey: string): Promise<string> {
    return this._setupPromise
      .then(async () => {
        const response = await this._dynamoClient.send(
          new GetCommand({
            TableName: "code-push-access-keys",
            Key: {
              accessKey,
            },
          })
        );
        if (response.Item) {
          return response.Item.accountId;
        }
      })
      .catch(() => {
        throw storage.storageError(ErrorCode.NotFound, "Access key not found");
      });
  }

  updateAccount(email: string, updates: storage.Account): Promise<void> {
    throw new Error("Method not implemented.");
  }

  addApp(accountId: string, app: storage.App): Promise<storage.App> {
    return this._setupPromise
      .then(async () => {
        app = storage.clone(app); // pass by value
        app.id = generate();
        app.accountId = accountId;
        app.deployments = [];

        const account = await this.getAccount(accountId);

        const collaboratorMap: storage.CollaboratorMap = {};
        collaboratorMap[account.email] = {
          accountId: accountId,
          permission: storage.Permissions.Owner,
          isCurrentAccount: true,
        } as storage.CollaboratorProperties;

        app.collaborators = collaboratorMap;
        await this._dynamoClient.send(
          new PutCommand({
            TableName: "code-push-apps",
            Item: app,
          })
        );
        return app;
      })
      .catch(() => {
        throw storage.storageError(
          ErrorCode.AlreadyExists,
          "App already exists"
        );
      });
  }

  getApps(accountId: string): Promise<storage.App[]> {
    return this._setupPromise
      .then(async () => {
        const response = await this._dynamoClient.send(
          new QueryCommand({
            TableName: "code-push-apps",
            IndexName: "accountId-index",
            KeyConditionExpression: "#accountId = :accountId",
            ExpressionAttributeNames: {
              "#accountId": "accountId",
            },
            ExpressionAttributeValues: {
              ":accountId": accountId,
            },
          })
        );
        if (response.Items) {
          return response.Items as storage.App[];
        } else {
          throw storage.storageError(ErrorCode.Other, "Could not get apps");
        }
      })
      .catch(() => {
        throw storage.storageError(ErrorCode.Other, "Could not get apps");
      });
  }

  getApp(accountId: string, appId: string): Promise<storage.App> {
    return this._setupPromise
      .then(async () => {
        const apps = await this.getApps(accountId);
        return apps.find((app) => app.id === appId);
      })
      .catch(() => {
        throw storage.storageError(ErrorCode.Other, "Could not get app");
      });
  }

  removeApp(accountId: string, appId: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  transferApp(accountId: string, appId: string, email: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  updateApp(accountId: string, app: storage.App): Promise<void> {
    throw new Error("Method not implemented.");
  }

  addCollaborator(
    accountId: string,
    appId: string,
    email: string
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  getCollaborators(
    accountId: string,
    appId: string
  ): Promise<storage.CollaboratorMap> {
    throw new Error("Method not implemented.");
  }

  removeCollaborator(
    accountId: string,
    appId: string,
    email: string
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  addDeployment(
    accountId: string,
    appId: string,
    deployment: storage.Deployment
  ): Promise<string> {
    return this._setupPromise
      .then(async () => {
        const app = await this.getApp(accountId, appId);
        await this._dynamoClient.send(
          new UpdateCommand({
            TableName: "code-push-apps",
            Key: {
              id: app.id,
            },
            UpdateExpression:
              "set deployments = list_append(deployments, :deployment)",
            ExpressionAttributeValues: {
              ":deployment": [deployment],
            },
            ReturnValues: "ALL_NEW",
          })
        );
      })
      .catch(() => {
        throw storage.storageError(ErrorCode.Other, "Could not add deployment");
      });
  }

  getDeployment(
    accountId: string,
    appId: string,
    deploymentId: string
  ): Promise<storage.Deployment> {
    return this._setupPromise
      .then(async () => {
        const deployments = await this.getDeployments(accountId, appId);
        return deployments.find((deployment) => deployment.id === deploymentId);
      })
      .catch(() => {
        throw storage.storageError(ErrorCode.Other, "Could not get deployment");
      });
  }

  getDeploymentInfo(deploymentKey: string): Promise<storage.DeploymentInfo> {
    throw new Error("Method not implemented.");
  }

  getDeployments(
    accountId: string,
    appId: string
  ): Promise<storage.Deployment[]> {
    return this._setupPromise.then(async () => {
      const response = await this._dynamoClient.send(
        new GetCommand({
          TableName: "code-push-apps",
          Key: {
            id: appId,
          },
        })
      );
      if (response.Item) {
        return response.Item.deployments as storage.Deployment[];
      } else {
        throw storage.storageError(ErrorCode.NotFound, "Deployment not found");
      }
    });
  }

  removeDeployment(
    accountId: string,
    appId: string,
    deploymentId: string
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  updateDeployment(
    accountId: string,
    appId: string,
    deployment: storage.Deployment
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  commitPackage(
    accountId: string,
    appId: string,
    deploymentId: string,
    appPackage: storage.Package
  ): Promise<storage.Package> {
    throw new Error("Method not implemented.");
  }

  clearPackageHistory(
    accountId: string,
    appId: string,
    deploymentId: string
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  getPackageHistoryFromDeploymentKey(
    deploymentKey: string
  ): Promise<storage.Package[]> {
    throw new Error("Method not implemented.");
  }

  getPackageHistory(
    accountId: string,
    appId: string,
    deploymentId: string
  ): Promise<storage.Package[]> {
    throw new Error("Method not implemented.");
  }

  updatePackageHistory(
    accountId: string,
    appId: string,
    deploymentId: string,
    history: storage.Package[]
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  addBlob(
    blobId: string,
    addstream: Readable,
    streamLength: number
  ): Promise<string> {
    throw new Error("Method not implemented.");
  }

  getBlobUrl(blobId: string): Promise<string> {
    throw new Error("Method not implemented.");
  }

  removeBlob(blobId: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  addAccessKey(
    accountId: string,
    accessKey: storage.AccessKey
  ): Promise<string> {
    return this._setupPromise
      .then(async () => {
        const response = await this._dynamoClient.send(
          new QueryCommand({
            TableName: "code-push-accounts",
            IndexName: "id-index",
            KeyConditionExpression: "#id = :id",
            ExpressionAttributeNames: {
              "#id": "id",
            },
            ExpressionAttributeValues: {
              ":id": accountId,
            },
          })
        );

        await this._dynamoClient.send(
          new UpdateCommand({
            TableName: "code-push-accounts",
            Key: {
              email: response.Items[0].email,
            },
            UpdateExpression: "set #accessKey = :accessKey",
            ExpressionAttributeNames: {
              "#accessKey": "accessKey",
            },
            ExpressionAttributeValues: {
              ":accessKey": accessKey.name,
            },
            ReturnValues: "ALL_NEW",
          })
        );

        // Create a new object, or we will actually remove the access key name from the original object which is needed to display the access key
        const newAccessKey = {};
        delete Object.assign(newAccessKey, accessKey, {
          ["accessKey"]: accessKey["name"],
        })["name"];
        Object.assign(newAccessKey, {
          ["accountId"]: accountId,
        });
        await this._dynamoClient.send(
          new PutCommand({
            TableName: "code-push-access-keys",
            Item: newAccessKey,
          })
        );
      })
      .catch(() => {
        throw storage.storageError(ErrorCode.Other, "Could not add access key");
      });
  }

  getAccessKey(
    accountId: string,
    accessKeyId: string // unused
  ): Promise<storage.AccessKey> {
    return this._setupPromise
      .then(async () => {
        const response = await this._dynamoClient.send(
          new QueryCommand({
            TableName: "code-push-accounts",
            IndexName: "id-index",
            KeyConditionExpression: "#id = :id",
            ExpressionAttributeNames: {
              "#id": "id",
            },
            ExpressionAttributeValues: {
              ":id": accountId,
            },
          })
        );
        return response.Items[0].accessKey;
      })
      .catch((e) => {
        throw storage.storageError(
          ErrorCode.Other,
          "Could not get access keys"
        );
      });
  }

  getAccessKeys(accountId: string): Promise<storage.AccessKey[]> {
    return this._setupPromise
      .then(async () => {
        const accessKey = await this.getAccessKey(accountId, "" /* unused */);
        return [accessKey];
      })
      .catch(() => {
        throw storage.storageError(
          ErrorCode.Other,
          "Could not get access keys"
        );
      });
  }

  removeAccessKey(accountId: string, accessKeyId: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  updateAccessKey(
    accountId: string,
    accessKey: storage.AccessKey
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  dropAll(): Promise<void> {
    throw new Error("Method not implemented.");
  }
}
