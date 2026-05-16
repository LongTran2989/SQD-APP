'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import toast from 'react-hot-toast';
import { X, Search } from 'lucide-react';

interface TransferOwnershipModalProps {
  templateId: number;
  currentOwnerId: number;
  onClose: () => void;
  onTransfer: (newOwner: { id: number; name: string }) => void;
}

interface UserOption {
  value: string;
  label: string;
}

export default function TransferOwnershipModal({ templateId, currentOwnerId, onClose, onTransfer }: TransferOwnershipModalProps) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [isTransferring, setIsTransferring] = useState(false);

  useEffect(() => {
    // Fetch users using the generic datasource route
    apiClient.get('/datasources/users')
      .then((res) => {
        // Filter out current owner
        const filteredUsers = res.data.filter((u: UserOption) => parseInt(u.value) !== currentOwnerId);
        setUsers(filteredUsers);
      })
      .catch(() => {
        toast.error('Failed to load users');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [currentOwnerId]);

  const handleTransfer = async () => {
    if (!selectedUserId) {
      toast.error('Please select a new owner');
      return;
    }

    if (!window.confirm('Are you sure you want to transfer ownership of this template? You may lose edit access.')) {
      return;
    }

    setIsTransferring(true);
    try {
      const response = await apiClient.post(`/templates/${templateId}/transfer`, { newOwnerId: selectedUserId });
      toast.success('Ownership transferred successfully');
      onTransfer(response.data.owner);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to transfer ownership');
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md border border-slate-100 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">Transfer Ownership</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-500">
            Select a user to transfer ownership to. Once transferred, the new owner will have full control over this template.
          </p>
          
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">New Owner</label>
            {loading ? (
              <div className="h-10 bg-slate-100 animate-pulse rounded-lg border border-slate-200"></div>
            ) : (
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a user...</option>
                {users.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleTransfer}
            disabled={!selectedUserId || isTransferring}
            className="px-4 py-2 bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
          >
            {isTransferring ? 'Transferring...' : 'Transfer Ownership'}
          </button>
        </div>
      </div>
    </div>
  );
}
