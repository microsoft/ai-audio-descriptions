@description('Name of the resource group')
param resourceGroupName string = 'rg-ai-audio-descriptions'

@description('Location for all resources')
@allowed([
  'westus'
  'swedencentral'
  'australiaeast'
])
param location string = 'westus'

@description('Name prefix for all resources')
param namePrefix string = 'aiad'

@description('Unique suffix for resource names')
param uniqueSuffix string = uniqueString(subscription().subscriptionId, resourceGroupName)

// AI Services resource for general cognitive services (speech, vision, etc.)
resource aiServices 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: '${namePrefix}-ai-${uniqueSuffix}'
  location: location
  kind: 'CognitiveServices'
  sku: {
    name: 'S0'
  }
  properties: {
    apiProperties: {}
    customSubDomainName: '${namePrefix}-ai-${uniqueSuffix}'
  }
}

// Separate Azure OpenAI account for GPT deployments
resource openAiAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: '${namePrefix}-openai-${uniqueSuffix}'
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: '${namePrefix}-openai-${uniqueSuffix}'
    publicNetworkAccess: 'Enabled'
  }
}

// OpenAI deployment for GPT-4o
resource gptDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAiAccount
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

// Storage account
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: '${namePrefix}storage${uniqueSuffix}'
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: true
  }
}

// Blob service
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
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

// Container for audio descriptions
resource audioDescriptionContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'audio-description'
  properties: {
    publicAccess: 'None'
  }
}

// Output values for configuration
output aiServicesName string = aiServices.name
output aiServicesRegion string = location
output openAiAccountName string = openAiAccount.name
output storageAccountName string = storageAccount.name
output gptDeploymentName string = gptDeployment.name
output resourceGroupName string = resourceGroupName
