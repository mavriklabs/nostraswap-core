pragma solidity =0.6.6;

// a library for handling binary fixed point numbers (https://en.wikipedia.org/wiki/Q_(number_format))

// range: [0, 2**112 - 1]
// resolution: 1 / 2**112

library UQ112x112 {
    uint224 constant Q112 = 2**112;
    uint256 constant Q224 = 2**224;

    // encode a uint112 as a UQ112x112
    function encode(uint112 y) internal pure returns (uint224 z) {
        z = uint224(y) * Q112; // never overflows
    }

    // divide a UQ112x112 by a uint112, returning a UQ112x112
    function uqdiv(uint224 x, uint112 y) internal pure returns (uint224 z) {
        z = x / uint224(y);
    }

    // find inverse of a UQ112x112, returning a UQ112x112
    function inverse(uint224 x) internal pure returns (uint224 z) {
        z = uint224(Q224 / uint256(x));
    }

    // multiply a UQ112x112 by a UQ112x112, returning a UQ112x112
    function uqmul(uint224 x, uint224 y) internal pure returns (uint224 z) {
        x = x / (2 ** 56);
        y = y / (2 ** 56);
        require(y == 0 || (z = x * y) / y == x, 'ds-math-mul-overflow');
    }
}
