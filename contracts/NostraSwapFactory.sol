pragma solidity =0.6.6;

import './interfaces/INostraSwapFactory.sol';
import './NostraSwapPair.sol';

contract NostraSwapFactory is INostraSwapFactory {
    address public override feeTo;
    address public override feeToSetter;
    address public override owner;
    address public uniswapFactory;
    address public WETH;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint);

    constructor(address _feeToSetter, address _owner, address _WETH, address _uniswapFactory) public {
        require(_WETH != address(0) && _uniswapFactory != address(0), 'NostraSwap: ZERO_ADDRESS');
        feeToSetter = _feeToSetter;
        owner = _owner;
        WETH = _WETH;
        uniswapFactory = _uniswapFactory;
    }

    function allPairsLength() external override view returns (uint) {
        return allPairs.length;
    }

    function createPair(address token1) external override returns (address pair) {
        address token0 = WETH;
        require(token0 != token1, 'NostraSwap: IDENTICAL_ADDRESSES');
        require(token1 != address(0), 'NostraSwap: ZERO_ADDRESS');
        require(getPair[token0][token1] == address(0), 'NostraSwap: PAIR_EXISTS'); // single check is sufficient
        address externalPool = INostraSwapFactory(uniswapFactory).getPair(token0, token1);
        require(externalPool != address(0));
        bytes memory bytecode = type(NostraSwapPair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        NostraSwapPair(pair).initialize(token0, token1, externalPool);
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
