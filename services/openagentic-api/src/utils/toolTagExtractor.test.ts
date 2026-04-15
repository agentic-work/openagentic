/**
 * Copyright 2026 Gnomus.ai
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

/**
 * Test file demonstrating toolTagExtractor functionality
 * This shows examples of tags generated for various tool names
 */

import { extractToolTags } from './toolTagExtractor.js';

// Test examples showing tag generation for different tool names
console.log('=== Tool Tag Extraction Examples ===\n');

// Example 1: Azure subscription tools
console.log('1. subscription_list');
console.log('   Tags:', extractToolTags('subscription_list'));
console.log('   Expected: ["subscription", "sub", "subs", "subscriptions", "list", "lst", ...]');
console.log();

// Example 2: Virtual machine tools
console.log('2. virtual_machine_create');
console.log('   Tags:', extractToolTags('virtual_machine_create'));
console.log('   Expected: ["virtual", "vm", "machine", "create", ...]');
console.log();

// Example 3: Database tools
console.log('3. database_query_execute');
console.log('   Tags:', extractToolTags('database_query_execute'));
console.log('   Expected: ["database", "db", "query", "execute", "dqe", ...]');
console.log();

// Example 4: CamelCase tool names
console.log('4. getUserProfile');
console.log('   Tags:', extractToolTags('getUserProfile'));
console.log('   Expected: ["get", "user", "profile", "gup", ...]');
console.log();

// Example 5: Kebab-case tool names
console.log('5. create-storage-account');
console.log('   Tags:', extractToolTags('create-storage-account'));
console.log('   Expected: ["create", "storage", "account", "csa", ...]');
console.log();

// Example 6: Generic action tools
console.log('6. list_resources');
console.log('   Tags:', extractToolTags('list_resources'));
console.log('   Expected: ["list", "resources", "lst", "res", ...]');
console.log();

// Example 7: Network tools
console.log('7. network_interface_attach');
console.log('   Tags:', extractToolTags('network_interface_attach'));
console.log('   Expected: ["network", "interface", "attach", "nia", "net", ...]');
console.log();

// Example 8: Container tools
console.log('8. container_registry_push');
console.log('   Tags:', extractToolTags('container_registry_push'));
console.log('   Expected: ["container", "registry", "push", "crp", "cont", ...]');
console.log();

console.log('\n=== Tag Matching Examples ===\n');
console.log('Query: "subs" should match tools with tags: ["sub", "subs", "subscriptions"]');
console.log('Query: "vm" should match tools with tags: ["vm", "virtual", "machine"]');
console.log('Query: "db" should match tools with tags: ["db", "database"]');
console.log('Query: "list" should match tools with tags: ["list", "lst"]');
