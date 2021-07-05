pragma solidity =0.6.6;

import '../NostraSwapERC20.sol';

contract ERC20 is NostraSwapERC20 {
    constructor(uint _totalSupply) public {
        _mint(msg.sender, _totalSupply);
    }
}
