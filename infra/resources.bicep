@description('Location for all resources. Must support GPT-5.5 in Foundry.')
@allowed([
  'eastus'
  'eastus2'
  'northcentralus'
  'southcentralus'
  'swedencentral'
])
param location string

@description('Expiration time for the development storage SAS token')
param sasExpiration string

var namePrefix = 'aiad'
var uniqueSuffix = uniqueString(subscription().subscriptionId, resourceGroup().id)
var containerName = 'audio-description'

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: '${namePrefix}-ai-${uniqueSuffix}'
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: '${namePrefix}-ai-${uniqueSuffix}'
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
    allowBlobPublicAccess: true
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
            'POST'
            'DELETE'
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

output VITE_FOUNDRY_RESOURCE string = foundry.name
output VITE_FOUNDRY_SPEECH_ENDPOINT string = 'wss://${location}.tts.speech.microsoft.com'
output VITE_GPT_DEPLOYMENT string = gptDeployment.name
output VITE_STORAGE_ACCOUNT string = storageAccount.name

@secure()
output VITE_FOUNDRY_KEY string = foundry.listKeys().key1

@secure()
output VITE_BLOB_SAS_TOKEN string = storageAccount.listServiceSas('2025-01-01', {
  canonicalizedResource: '/blob/${storageAccount.name}/${containerName}'
  signedExpiry: sasExpiration
  signedPermission: 'racwdl'
  signedProtocol: 'https'
  signedResource: 'c'
}).serviceSasToken
