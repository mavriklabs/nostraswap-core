pragma solidity =0.6.6;

import './../interfaces/IExternalNostraSwapFactory.sol';
import './ExternalNostraSwapPair.sol';

contract ExternalNostraSwapFactory is IExternalNostraSwapFactory {
    address public override feeTo;
    address public override feeToSetter;
    address public override owner;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint);

    constructor(address _feeToSetter, address _owner) public {
        feeToSetter = _feeToSetter;
        owner = _owner;
    }

    function allPairsLength() external override view returns (uint) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        require(tokenA != tokenB, 'NostraSwap: IDENTICAL_ADDRESSES');
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'NostraSwap: ZERO_ADDRESS');
        require(getPair[token0][token1] == address(0), 'NostraSwap: PAIR_EXISTS'); // single check is sufficient
        bytes memory bytecode = type(ExternalNostraSwapPair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        ExternalNostraSwapPair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external override {
        require(msg.sender == feeToSetter, 'NostraSwap: FORBIDDEN');
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external override {
        require(msg.sender == feeToSetter, 'NostraSwap: FORBIDDEN');
        feeToSetter = _feeToSetter;
    }

    function setOwner(address _owner) external override {
        require(msg.sender == owner, 'NostraSwap: FORBIDDEN');
        require(_owner != address(0), 'NostraSwap: OWNER_ZERO_ADDRESS');
        owner = _owner;
    }
}