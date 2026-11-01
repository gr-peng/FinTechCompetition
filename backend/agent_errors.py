"""Stable exception identities while the explicit local validation mode reloads code."""
class ContractError(ValueError):
    pass

class ProviderError(Exception):
    def __init__(self,code,message,status=502):
        super().__init__(message);self.code=code;self.message=message;self.status=status
