@description('Name of the resource group')
param resourceGroupName string = 'aiad'

@description('Location for all resources. Must be a region that supports GPT-5.5 in Foundry (as of mid-2026): eastus, eastus2, northcentralus, polandcentral, southcentralus, swedencentral.')
@allowed([
  'eastus'
  'eastus2'
  'northcentralus'
  'southcentralus'
  'swedencentral'
])
param location string = 'eastus2'

@description('Name prefix for all resources')
param namePrefix string = 'aiad'

// Unique suffix ensures globally unique resource names for storage and Foundry.
@description('Unique suffix for resource names')
param uniqueSuffix string = uniqueString(subscription().subscriptionId, resourceGroupName)

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
  name: 'audio-description'
}

// Output values for configuration
output foundryName string = foundry.name
output foundrySpeechEndpoint string = 'wss://${location}.tts.speech.microsoft.com'
output storageAccountName string = storageAccount.name
output gptDeploymentName string = gptDeployment.name
output resourceGroupName string = resourceGroupName