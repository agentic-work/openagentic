# Proprietary and confidential. Unauthorized copying prohibited.

import torch

# Check if CUDA is available
if torch.cuda.is_available():
    device = torch.device('cuda')
    print('CUDA is available. Using device:', device)
else:
    device = torch.device('cpu')
    print('CUDA not available. Using CPU.')

# Create a large tensor on the GPU (if available)
size = (1000, 1000)
print(f'Creating tensor of size {size} on {device}')
A = torch.randn(size, device=device)
B = torch.randn(size, device=device)

# Perform a matrix multiplication on the GPU
print('Performing matrix multiplication...')
C = torch.matmul(A, B)
print('Result tensor shape:', C.shape)
print('Sum of elements:', C.sum().item())
