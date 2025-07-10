@description('Name of the resource group')
param resourceGroupName string = 'aiad'

@description('Location for all resources')
@allowed([
  'westus'
  'swedencentral'
  'australiaeast'
])
param location string = 'westus'

@description('Name prefix for all resources')
param namePrefix string = 'aiad'

// Unique suffix ensures globally unique resource names (required for storage accounts and AI services custom domains)
@description('Unique suffix for resource names')
param uniqueSuffix string = uniqueString(subscription().subscriptionId, resourceGroupName)

resource aiServices 'Microsoft.CognitiveServices/accounts@2025-01-01' = {
  name: '${namePrefix}-ai-${uniqueSuffix}'
  location: location
  kind: 'CognitiveServices'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: '${namePrefix}-ai-${uniqueSuffix}'
  }
}

resource gptDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-01-01' = {
  parent: aiServices
  name: 'gpt-4o'
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o'
      version: '2024-08-06'
    }
  }
  sku: {
    name: 'Standard'
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
output aiServicesName string = aiServices.name
output aiServicesRegion string = location
output storageAccountName string = storageAccount.name
output gptDeploymentName string = gptDeployment.name
output resourceGroupName string = resourceGroupName