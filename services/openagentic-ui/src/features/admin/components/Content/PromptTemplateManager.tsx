/**
 * Prompt Template Manager Component
 *
 * Admin Portal component for managing prompt templates with full CRUD operations.
 * Features:
 * - List all prompt templates with search and filtering
 * - Create new templates
 * - Edit existing templates
 * - Delete templates (with confirmation)
 * - Set default template
 * - Assign templates to users
 * - View template assignments
 */

import React, { useState, useEffect } from 'react';
// Basic UI icons from lucide
import {
  Plus, Edit, Trash2, Star, Search, Code, Save, X, ChevronDown, Check
} from '@/shared/icons';
// Custom badass OpenAgentic icons
import { User, RefreshCw, Loader2, AlertCircle } from '../Shared/AdminIcons';
import { apiRequest } from '@/utils/api';

interface PromptTemplate {
  id: number;
  name: string;
  category: string;
  content: string;
  description?: string;
  tags?: string[];
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  assignedUsersCount?: number;
}

interface UserAssignment {
  id: string;
  user_id: string;
  prompt_template_id: number;
  assigned_by: string;
  assigned_at: string;
  user: {
    id: string;
    email: string;
    name?: string;
    is_admin: boolean;
  };
}

interface User {
  id: string;
  email: string;
  name?: string;
  is_admin: boolean;
}

export const PromptTemplateManager: React.FC = () => {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [viewAssignmentsOpen, setViewAssignmentsOpen] = useState(false);
  const [assignments, setAssignments] = useState<UserAssignment[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Form state for creating/editing
  const [formData, setFormData] = useState({
    name: '',
    category: 'general',
    content: '',
    description: '',
    is_default: false,
    is_active: true
  });

  useEffect(() => {
    loadTemplates();
    loadUsers();
  }, []);

  useEffect(() => {
    filterTemplates();
  }, [searchTerm, categoryFilter, templates]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/admin/prompts/templates');
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || []);
      }
    } catch (error: any) {
      showNotification('Failed to load templates: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await apiRequest('/admin/prompts/users');
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (error: any) {
      console.error('Failed to load users:', error);
    }
  };

  const loadAssignments = async (templateId: number) => {
    try {
      const response = await apiRequest(`/admin/prompts/templates/${templateId}/assignments`);
      if (response.ok) {
        const data = await response.json();
        setAssignments(data.assignments || []);
      }
    } catch (error: any) {
      showNotification('Failed to load assignments: ' + error.message, 'error');
    }
  };

  const filterTemplates = () => {
    let filtered = templates;

    if (searchTerm) {
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter(t => t.category === categoryFilter);
    }

    setFilteredTemplates(filtered);
  };

  const handleCreate = () => {
    setFormData({
      name: '',
      category: 'general',
      content: '',
      description: '',
      is_default: false,
      is_active: true
    });
    setIsCreating(true);
  };

  const handleEdit = (template: PromptTemplate) => {
    setSelectedTemplate(template);
    setFormData({
      name: template.name,
      category: template.category,
      content: template.content,
      description: template.description || '',
      is_default: template.is_default,
      is_active: template.is_active
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      if (isCreating) {
        const response = await apiRequest('/admin/prompts/templates', {
          method: 'POST',
          body: JSON.stringify(formData)
        });
        if (!response.ok) throw new Error('Failed to create template');
        showNotification('Template created successfully', 'success');
      } else if (isEditing && selectedTemplate) {
        const response = await apiRequest(`/admin/prompts/templates/${selectedTemplate.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData)
        });
        if (!response.ok) throw new Error('Failed to update template');
        showNotification('Template updated successfully', 'success');
      }
      await loadTemplates();
      handleCancel();
    } catch (error: any) {
      showNotification('Failed to save template: ' + error.message, 'error');
    }
  };

  const handleDelete = async () => {
    if (!selectedTemplate) return;

    try {
      const response = await apiRequest(`/admin/prompts/templates/${selectedTemplate.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete template');
      showNotification('Template deleted successfully', 'success');
      await loadTemplates();
      setDeleteConfirmOpen(false);
      setSelectedTemplate(null);
    } catch (error: any) {
      showNotification('Failed to delete template: ' + error.message, 'error');
    }
  };

  const handleSetDefault = async (template: PromptTemplate) => {
    try {
      const response = await apiRequest(`/admin/prompts/templates/${template.id}/set-default`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to set default template');
      showNotification(`"${template.name}" set as default template`, 'success');
      await loadTemplates();
    } catch (error: any) {
      showNotification('Failed to set default template: ' + error.message, 'error');
    }
  };

  const handleAssignToUser = async () => {
    if (!selectedTemplate || !selectedUserId) return;

    try {
      const response = await apiRequest(`/admin/prompts/templates/${selectedTemplate.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({
          user_id: selectedUserId,
          assigned_by: 'admin'
        })
      });
      if (!response.ok) throw new Error('Failed to assign template');
      showNotification('Template assigned to user successfully', 'success');
      setAssignDialogOpen(false);
      setSelectedUserId('');
      await loadTemplates();
    } catch (error: any) {
      showNotification('Failed to assign template: ' + error.message, 'error');
    }
  };

  const handleUnassign = async (assignment: UserAssignment) => {
    try {
      const response = await apiRequest(`/admin/prompts/templates/${assignment.prompt_template_id}/assign/${assignment.user_id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to unassign template');
      showNotification('Template unassigned successfully', 'success');
      await loadAssignments(assignment.prompt_template_id);
    } catch (error: any) {
      showNotification('Failed to unassign template: ' + error.message, 'error');
    }
  };

  const handleViewAssignments = async (template: PromptTemplate) => {
    setSelectedTemplate(template);
    await loadAssignments(template.id);
    setViewAssignmentsOpen(true);
  };

  const handleSyncFromCode = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/admin/prompts/templates/sync', {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to sync templates');
      showNotification('Templates synced from code successfully', 'success');
      await loadTemplates();
    } catch (error: any) {
      showNotification('Failed to sync templates: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setIsEditing(false);
    setSelectedTemplate(null);
  };

  const showNotification = (message: string, type: 'success' | 'error' | 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const categories = ['general', 'admin', 'development', 'analysis', 'creative', 'technical'];
  const uniqueCategories = Array.from(new Set(templates.map(t => t.category)));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-text-primary">Prompt Template Manager</h2>
        <div className="flex gap-2">
          <button
            onClick={handleSyncFromCode}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-surface-elevated border border-border rounded-lg hover:bg-surface-base transition-colors disabled:opacity-50"
            title="Sync templates from code"
          >
            <Code className="w-4 h-4" />
          </button>
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-on-accent rounded-lg hover:bg-primary-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Template
          </button>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className={`p-4 rounded-lg flex items-center gap-2 ${
          notification.type === 'success' ? 'bg-success-500/20 ap-text-success border border-success/30' :
          notification.type === 'error' ? 'bg-error-500/20 ap-text-error border border-error/30' :
          'bg-primary-500/20 text-primary-500 border border-primary/30'
        }`}>
          {notification.type === 'success' && <Check className="w-4 h-4" />}
          {notification.type === 'error' && <AlertCircle className="w-4 h-4" />}
          {notification.message}
        </div>
      )}

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-64">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search templates..."
                className="w-full pl-10 pr-4 py-2 bg-surface-base border border-border rounded-lg text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="appearance-none px-4 py-2 pr-8 bg-surface-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary"
            >
              <option value="all">All Categories</option>
              {uniqueCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
          </div>
          <span className="text-text-secondary text-sm">
            {filteredTemplates.length} of {templates.length} templates
          </span>
        </div>
      </div>

      {/* Templates Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-text-secondary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => (
            <div key={template.id} className="glass-card p-4 flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-text-primary">{template.name}</h3>
                    {template.is_default && (
                      <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-primary-500/20 text-primary-500 rounded-full">
                        <Star className="w-3 h-3" />
                        Default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 text-xs bg-surface-base text-text-secondary rounded">
                      {template.category}
                    </span>
                    {!template.is_active && (
                      <span className="px-2 py-0.5 text-xs bg-error-500/20 ap-text-error rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleSetDefault(template)}
                  disabled={template.is_default}
                  className="p-1 hover:bg-surface-base rounded transition-colors disabled:opacity-50"
                  title={template.is_default ? 'Already default' : 'Set as default'}
                >
                  <Star className={`w-5 h-5 ${template.is_default ? 'text-primary-500 fill-[var(--color-nfo)]' : 'text-text-secondary'}`} />
                </button>
              </div>

              <p className="text-sm text-text-secondary mb-3 flex-1 line-clamp-2">
                {template.description || template.content.substring(0, 100) + '...'}
              </p>

              <div className="flex items-center justify-between text-xs text-text-secondary mb-3">
                <span>Updated: {new Date(template.updated_at).toLocaleDateString()}</span>
                {template.assignedUsersCount > 0 && (
                  <span className="px-2 py-0.5 bg-primary-500/20 text-primary-500 rounded">
                    {template.assignedUsersCount} user{template.assignedUsersCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
                <button
                  onClick={() => handleEdit(template)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-surface-base hover:bg-surface-elevated border border-border rounded transition-colors"
                >
                  <Edit className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => {
                    setSelectedTemplate(template);
                    setAssignDialogOpen(true);
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-surface-base hover:bg-surface-elevated border border-border rounded transition-colors"
                >
                  <User className="w-3 h-3" />
                  Assign
                </button>
                <button
                  onClick={() => handleViewAssignments(template)}
                  className="px-3 py-1.5 text-sm bg-surface-base hover:bg-surface-elevated border border-border rounded transition-colors"
                >
                  Assignments
                </button>
                <button
                  onClick={() => {
                    setSelectedTemplate(template);
                    setDeleteConfirmOpen(true);
                  }}
                  disabled={template.is_default}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-error-500/10 hover:bg-error-500/20 ap-text-error border border-error/30 rounded transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {(isCreating || isEditing) && (
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-shadow)_50%,transparent)] flex items-center justify-center z-50 p-4">
          <div className="bg-surface-elevated border border-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">
                {isCreating ? 'Create Template' : 'Edit Template'}
              </h3>
              <button onClick={handleCancel} className="p-1 hover:bg-surface-base rounded">
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label htmlFor="prompt-template-name" className="block text-sm font-medium text-text-primary mb-1">Template Name *</label>
                <input
                  id="prompt-template-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary"
                  required
                />
              </div>

              <div>
                <label htmlFor="prompt-template-category" className="block text-sm font-medium text-text-primary mb-1">Category</label>
                <select
                  id="prompt-template-category"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary"
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="prompt-template-description" className="block text-sm font-medium text-text-primary mb-1">Description</label>
                <textarea
                  id="prompt-template-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-surface-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div>
                <label htmlFor="prompt-template-content" className="block text-sm font-medium text-text-primary mb-1">Template Content *</label>
                <textarea
                  id="prompt-template-content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  rows={10}
                  placeholder="Enter the system prompt template content..."
                  className="w-full px-3 py-2 bg-surface-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary resize-none font-mono text-sm"
                  required
                />
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-4 h-4 rounded border-border bg-surface-base"
                  />
                  <span className="text-sm text-text-primary">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_default}
                    onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                    className="w-4 h-4 rounded border-border bg-surface-base"
                  />
                  <span className="text-sm text-text-primary">Set as Default</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-border">
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 bg-surface-base border border-border rounded-lg hover:bg-surface-elevated transition-colors"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-on-accent rounded-lg hover:bg-primary-600 transition-colors"
              >
                <Save className="w-4 h-4" />
                {isCreating ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-shadow)_50%,transparent)] flex items-center justify-center z-50 p-4">
          <div className="bg-surface-elevated border border-border rounded-lg w-full max-w-md">
            <div className="p-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">Confirm Delete</h3>
            </div>
            <div className="p-4">
              <p className="text-text-secondary">
                Are you sure you want to delete the template "{selectedTemplate?.name}"?
                This action cannot be undone.
              </p>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-border">
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                className="px-4 py-2 bg-surface-base border border-border rounded-lg hover:bg-surface-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-error-500 text-on-accent rounded-lg hover:bg-error-500 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign to User Modal */}
      {assignDialogOpen && (
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-shadow)_50%,transparent)] flex items-center justify-center z-50 p-4">
          <div className="bg-surface-elevated border border-border rounded-lg w-full max-w-md">
            <div className="p-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">Assign Template to User</h3>
            </div>
            <div className="p-4">
              <label htmlFor="prompt-template-assign-user" className="block text-sm font-medium text-text-primary mb-2">Select User</label>
              <select
                id="prompt-template-assign-user"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-3 py-2 bg-surface-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary"
              >
                <option value="">Select a user...</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.email} {user.name ? `(${user.name})` : ''} {user.is_admin ? '[Admin]' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-border">
              <button
                onClick={() => setAssignDialogOpen(false)}
                className="px-4 py-2 bg-surface-base border border-border rounded-lg hover:bg-surface-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignToUser}
                disabled={!selectedUserId}
                className="px-4 py-2 bg-primary-600 text-on-accent rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50"
              >
                Assign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Assignments Modal */}
      {viewAssignmentsOpen && (
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-shadow)_50%,transparent)] flex items-center justify-center z-50 p-4">
          <div className="bg-surface-elevated border border-border rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">
                Template Assignments: {selectedTemplate?.name}
              </h3>
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              {assignments.length === 0 ? (
                <div className="flex items-center gap-2 p-4 bg-primary-500/10 text-primary-500 rounded-lg">
                  <AlertCircle className="w-4 h-4" />
                  No users assigned to this template
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-sm font-medium text-text-secondary">User</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-text-secondary">Email</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-text-secondary">Assigned At</th>
                      <th className="text-right py-2 px-3 text-sm font-medium text-text-secondary">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map(assignment => (
                      <tr key={assignment.id} className="border-b border-border">
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <span className="text-text-primary">{assignment.user.name || 'N/A'}</span>
                            {assignment.user.is_admin && (
                              <span className="px-1.5 py-0.5 text-xs bg-info-500/20 ap-text-info rounded">Admin</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-text-secondary">{assignment.user.email}</td>
                        <td className="py-2 px-3 text-text-secondary text-sm">
                          {new Date(assignment.assigned_at).toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => handleUnassign(assignment)}
                            className="px-3 py-1 text-sm bg-error-500/10 hover:bg-error-500/20 ap-text-error rounded transition-colors"
                          >
                            Unassign
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex justify-end p-4 border-t border-border">
              <button
                onClick={() => setViewAssignmentsOpen(false)}
                className="px-4 py-2 bg-surface-base border border-border rounded-lg hover:bg-surface-elevated transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PromptTemplateManager;
