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
var foundryUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

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

resource foundryUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, principalId, foundryUserRoleId)
  scope: foundry
  properties: {
    principalId: principalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', foundryUserRoleId)
  }
}

output FOUNDRY_RESOURCE string = foundry.name
output FOUNDRY_RESOURCE_ID string = foundry.id
output GPT_DEPLOYMENT string = gptDeployment.name
