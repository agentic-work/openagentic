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
 * User Service
 * 
 * Manages user account operations including creation, authentication, profile
 * management, and administrative functions. Handles both local and Azure AD
 * user accounts with secure password hashing and role management.
 * 
 * Features:
 * - User account creation and profile management
 * - Secure password hashing with bcrypt
 * - Admin user provisioning from environment variables
 * - User role and permission management
 * - Account status and profile updates
 * - Integration with authentication providers
 */

import type { Logger } from 'pino';
import bcrypt from 'bcrypt';
import { prisma } from '../utils/prisma.js';

export class UserService {
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Ensure admin user exists from environment variables
   */
  async ensureAdminUser(): Promise<void> {
    try {
      const adminEmail = process.env.ADMIN_USER_EMAIL;
      const adminPassword = process.env.ADMIN_USER_PASSWORD;

      if (!adminEmail || !adminPassword) {
        this.logger.warn('ADMIN_USER_EMAIL or ADMIN_USER_PASSWORD not set in environment - skipping admin user creation');
        return;
      }

      // Check if admin user exists
      const existingUser = await prisma.user.findUnique({
        where: { email: adminEmail }
      });

      if (!existingUser) {
        // Create admin user
        const passwordHash = await bcrypt.hash(adminPassword, 10);
        
        // Check if password reset should be required
        const requirePasswordReset = process.env.ADMIN_REQUIRE_PASSWORD_RESET !== 'false';
        
        await prisma.user.create({
          data: {
            email: adminEmail,
            name: 'System Administrator',
            password_hash: passwordHash,
            is_admin: true,
            groups: ['admin', 'users', 'OpenAgenticAdmins'],
            force_password_change: requirePasswordReset
          }
        });
        
        if (requirePasswordReset) {
          this.logger.info(`✅ Created admin user: ${adminEmail} (password must be changed on first login)`);
        } else {
          this.logger.info(`✅ Created admin user: ${adminEmail} (password reset disabled by ADMIN_REQUIRE_PASSWORD_RESET=false)`);
        }
      } else {
        // Ensure existing user is admin
        if (!existingUser.is_admin) {
          await prisma.user.update({
            where: { email: adminEmail },
            data: { 
              is_admin: true,
              groups: ['admin', 'users', 'OpenAgenticAdmins']
            }
          });
          this.logger.info(`✅ Updated user to admin: ${adminEmail}`);
        } else {
          this.logger.info(`✅ Admin user already exists: ${adminEmail}`);
        }
      }
    } catch (error) {
      this.logger.error('Error ensuring admin user:', error);
      throw error;
    }
  }

  /**
   * Validate admin user exists
   */
  async validateAdminUser(): Promise<{ 
    healthy: boolean; 
    adminEmail: string | undefined; 
    exists: boolean; 
    isAdmin: boolean;
    configured: boolean;
  }> {
    try {
      const adminEmail = process.env.ADMIN_USER_EMAIL;
      const adminPassword = process.env.ADMIN_USER_PASSWORD;
      const configured = !!(adminEmail && adminPassword);

      if (!configured) {
        return {
          healthy: false,
          adminEmail: undefined,
          exists: false,
          isAdmin: false,
          configured: false
        };
      }
      
      const existingUser = await prisma.user.findUnique({
        where: { email: adminEmail }
      });

      const exists = !!existingUser;
      const isAdmin = exists && existingUser.is_admin;
      const healthy = exists && isAdmin;

      return {
        healthy,
        adminEmail,
        exists,
        isAdmin,
        configured
      };
    } catch (error) {
      this.logger.error('Error validating admin user:', error);
      return {
        healthy: false,
        adminEmail: process.env.ADMIN_USER_EMAIL,
        exists: false,
        isAdmin: false,
        configured: false
      };
    }
  }
}