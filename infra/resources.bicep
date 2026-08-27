@description('Location for all resources. Must support GPT-5.5 in Foundry.')
@allowed([
  'eastus'
  'eastus2'
  'northcentralus'
  'southcentralus'
  'swedencentral'
])
param location string

@description('Object ID of the developer running the application')
param principalId string

var namePrefix = 'aiad'
var uniqueSuffix = uniqueString(subscription().subscriptionId, resourceGroup().id)
var containerName = 'audio-description'
var foundryUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: '${namePrefix}-ai-${uniqueSuffix}'
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: '${namePrefix}-ai-${uniqueSuffix}'
    disableLocalAuth: true
  }
}

resource gptDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: foundry
  name: 'gpt-5.5'
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-5.5'
      version: '2026-04-24'
    }
  }
  sku: {
    name: 'GlobalStandard'
    capacity: 30
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: '${namePrefix}storage${uniqueSuffix}'
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: [
            'http://localhost:5173'
            'http://localhost:3000'
            'https://localhost:5173'
            'https://localhost:3000'
          ]
          allowedMethods: [
            'GET'
            'PUT'
            'HEAD'
            'OPTIONS'
          ]
          allowedHeaders: [
            '*'
          ]
          exposedHeaders: [
            '*'
          ]
          maxAgeInSeconds: 9999
        }
      ]
    }
  }
}

resource audioDescriptionContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: containerName
}

resource foundryUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, principalId, foundryUserRoleId)
  scope: foundry
  properties: {
    principalId: principalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', foundryUserRoleId)
  }
}

resource storageBlobDataContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, principalId, storageBlobDataContributorRoleId)
  scope: storageAccount
  properties: {
    principalId: principalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
  }
}

output FOUNDRY_RESOURCE string = foundry.name
output FOUNDRY_RESOURCE_ID string = foundry.id
output GPT_DEPLOYMENT string = gptDeployment.name
output STORAGE_ACCOUNT string = storageAccount.name
