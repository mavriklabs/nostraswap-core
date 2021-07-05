import BN from 'bignumber.js'
import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'
import { BigNumber, bigNumberify } from 'ethers/utils'

import { expandTo18Decimals, mineBlock, encodePrice } from './shared/utilities'
import { pairFixture } from './shared/fixtures'
import { AddressZero } from 'ethers/constants'

const MINIMUM_LIQUIDITY = bigNumberify(10).pow(3)

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('NostraSwapPair', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999,
  })
  const [wallet, other] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet, other])

  let factory: Contract
  let token0: Contract
  let token1: Contract
  let pair: Contract
  let externalFactory: Contract
  let externalPair: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(pairFixture)
    factory = fixture.factory
    token0 = fixture.token0
    token1 = fixture.token1
    pair = fixture.pair
    externalFactory = fixture.externalFactory
    externalPair = fixture.externalPair
  })

  it('mint', async () => {
    const token0Amount = expandTo18Decimals(1)
    const token1Amount = expandTo18Decimals(4)
    await token0.transfer(pair.address, token0Amount)
    await token1.transfer(pair.address, token1Amount)

    const expectedLiquidity = expandTo18Decimals(2)
    await expect(pair.mint(wallet.address, overrides))
      .to.emit(pair, 'Transfer')
      .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
      .to.emit(pair, 'Transfer')
      .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(pair, 'Sync')
      .withArgs(token0Amount, token1Amount)
      .to.emit(pair, 'Mint')
      .withArgs(wallet.address, token0Amount, token1Amount)

    expect(await pair.totalSupply()).to.eq(expectedLiquidity)
    expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    expect(await token0.balanceOf(pair.address)).to.eq(token0Amount)
    expect(await token1.balanceOf(pair.address)).to.eq(token1Amount)
    const reserves = await pair.getReserves()
    expect(reserves[0]).to.eq(token0Amount)
    expect(reserves[1]).to.eq(token1Amount)
  })

  async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
    await token0.transfer(pair.address, token0Amount)
    await token1.transfer(pair.address, token1Amount)
    await pair.mint(wallet.address, overrides)
  }

  const swapTestCases: BigNumber[][] = [
    [1, 5, 10, '1662497915624478906'],
    [1, 10, 5, '453305446940074565'],

    [2, 5, 10, '2851015155847869602'],
    [2, 10, 5, '831248957812239453'],

    [1, 10, 10, '906610893880149131'],
    [1, 100, 100, '987158034397061298'],
    [1, 1000, 1000, '996006981039903216']
  ].map(a => a.map(n => (typeof n === 'string' ? bigNumberify(n) : expandTo18Decimals(n))))
  swapTestCases.forEach((swapTestCase, i) => {
    it(`getInputPrice:${i}`, async () => {
      const [swapAmount, token0Amount, token1Amount, expectedOutputAmount] = swapTestCase
      await addLiquidity(token0Amount, token1Amount)
      await token0.transfer(pair.address, swapAmount)
      await expect(pair.swap(0, expectedOutputAmount.add(1), wallet.address, '0x', overrides)).to.be.revertedWith(
        'NostraSwap: K'
      )
      await pair.swap(0, expectedOutputAmount, wallet.address, '0x', overrides)
    })
  })

  const optimisticTestCases: BigNumber[][] = [
    ['997000000000000000', 5, 10, 1], // given amountIn, amountOut = floor(amountIn * .997)
    ['997000000000000000', 10, 5, 1],
    ['997000000000000000', 5, 5, 1],
    [1, 5, 5, '1003009027081243732'] // given amountOut, amountIn = ceiling(amountOut / .997)
  ].map(a => a.map(n => (typeof n === 'string' ? bigNumberify(n) : expandTo18Decimals(n))))
  optimisticTestCases.forEach((optimisticTestCase, i) => {
    it(`optimistic:${i}`, async () => {
      const [outputAmount, token0Amount, token1Amount, inputAmount] = optimisticTestCase
      await addLiquidity(token0Amount, token1Amount)
      await token0.transfer(pair.address, inputAmount)
      await expect(pair.swap(outputAmount.add(1), 0, wallet.address, '0x', overrides)).to.be.revertedWith(
        'NostraSwap: K'
      )
      await pair.swap(outputAmount, 0, wallet.address, '0x', overrides)
    })
  })

  it('swap:token0', async () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)
    const oldReserves = await pair.getReserves()
    const oldExternal = await externalPair.getReserves()
    expect(oldReserves[0]).to.eq(token0Amount)
    expect(oldReserves[1]).to.eq(token1Amount)
    let bal0 = await token0.balanceOf(wallet.address)
    let bal1 = await token1.balanceOf(wallet.address)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = bigNumberify('1662497915624478906')

    await token0.transfer(pair.address, swapAmount)
    const txnReceipt = await pair.swap(0, expectedOutputAmount, wallet.address, '0x', overrides)

    const cost = txnReceipt.gasPrice.mul(100000)

    // Check that trader got compensated
    expect(await token0.balanceOf(wallet.address)).to.be.eq(bal0.sub(swapAmount).add(cost))
    expect(await token1.balanceOf(wallet.address)).to.be.eq(bal1.add(expectedOutputAmount))

    const newReserves = await pair.getReserves()
    const newExternal = await externalPair.getReserves()

    // Check that profit stays in our pool and externalPool got only fee
    expect(newReserves[0].mul(newReserves[1])).to.be.gte(oldReserves[0].mul(oldReserves[1]).mul(101).div(100))
    expect(oldExternal[0].mul(oldExternal[1])).to.be.lte(newExternal[0].mul(newExternal[1]).mul(1001).div(1000))

    // Check that reserves and balances make sense
    expect(newReserves[0].add(newExternal[0]).add(await token0.balanceOf(wallet.address))).to.be.eq(oldReserves[0].add(oldExternal[0]).add(bal0))
    expect(newReserves[1].add(newExternal[1]).add(await token1.balanceOf(wallet.address))).to.be.eq(oldReserves[1].add(oldExternal[1]).add(bal1))

    // Check that arbitrage is efficient
    const o0 = new BN(newReserves[0].toString())
    const o1 = new BN(newReserves[1].toString())  
    const u0 = new BN(newExternal[0].toString())
    const u1 = new BN(newExternal[1].toString())  
    const price = o1.div(o0)
    const externalPrice = u1.div(u0)

    const eff = (externalPrice >= price.multipliedBy(new BN(0.9969))) && (externalPrice <= price.multipliedBy(new BN(1.0031)))
    expect(eff).to.be.true
  })

  it('swap:token1', async () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)
    const oldReserves = await pair.getReserves()
    const oldExternal = await externalPair.getReserves()
    expect(oldReserves[0]).to.eq(token0Amount)
    expect(oldReserves[1]).to.eq(token1Amount)
    let bal0 = await token0.balanceOf(wallet.address)
    let bal1 = await token1.balanceOf(wallet.address)
    
    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = bigNumberify('453305446940074565')

    await token1.transfer(pair.address, swapAmount)
    const txnReceipt = await pair.swap(expectedOutputAmount, 0, wallet.address, '0x', overrides)

    const cost = txnReceipt.gasPrice.mul(100000)

    // Check that trader got compensated
    expect(await token0.balanceOf(wallet.address)).to.be.eq(bal0.add(expectedOutputAmount).add(cost))
    expect(await token1.balanceOf(wallet.address)).to.be.eq(bal1.sub(swapAmount))

    const newReserves = await pair.getReserves()
    const newExternal = await externalPair.getReserves()

    // Check that profit stays in our pool and externalPool got only fee
    expect(newReserves[0].mul(newReserves[1])).to.be.gte(oldReserves[0].mul(oldReserves[1]).mul(1005).div(1000))
    expect(oldExternal[0].mul(oldExternal[1])).to.be.lte(newExternal[0].mul(newExternal[1]).mul(1001).div(1000))

    // Check that reserves and balances make sense
    expect(newReserves[0].add(newExternal[0]).add(await token0.balanceOf(wallet.address))).to.be.eq(oldReserves[0].add(oldExternal[0]).add(bal0))
    expect(newReserves[1].add(newExternal[1]).add(await token1.balanceOf(wallet.address))).to.be.eq(oldReserves[1].add(oldExternal[1]).add(bal1))

    // Check that arbitrage is efficient
    const o0 = new BN(newReserves[0].toString())
    const o1 = new BN(newReserves[1].toString())  
    const u0 = new BN(newExternal[0].toString())
    const u1 = new BN(newExternal[1].toString())  
    const price = o1.div(o0)
    const externalPrice = u1.div(u0)

    const eff = (externalPrice >= price.multipliedBy(new BN(0.9969))) && (externalPrice <= price.multipliedBy(new BN(1.0031)))
    expect(eff).to.be.true
  })

  it('swap:not overflow', async () => {
    const token0Amount = bigNumberify(1)
    const token1Amount = bigNumberify(2).pow(112).sub(1)
    await addLiquidity(token0Amount, token1Amount)
    const oldReserves = await pair.getReserves()
    const oldExternal = await externalPair.getReserves()
    expect(oldReserves[0]).to.eq(token0Amount)
    expect(oldReserves[1]).to.eq(token1Amount)
    let bal0 = await token0.balanceOf(wallet.address)
    let bal1 = await token1.balanceOf(wallet.address)

    let swapAmount = expandTo18Decimals(1)
    let expectedOutputAmount = bigNumberify('2592248356514383147543768072224554')
    await token0.transfer(pair.address, swapAmount)
    const txnReceipt = await pair.swap(0, expectedOutputAmount, wallet.address, '0x', overrides)

    const cost = txnReceipt.gasPrice.mul(100000)

    // Check that trader got compensated
    expect(await token0.balanceOf(wallet.address)).to.be.eq(bal0.sub(swapAmount).add(cost))
    expect(await token1.balanceOf(wallet.address)).to.be.eq(bal1.add(expectedOutputAmount))

    const newReserves = await pair.getReserves()
    const newExternal = await externalPair.getReserves()

    // Check that profit stays in our pool and externalPool got only fee
    expect(newReserves[0].mul(newReserves[1])).to.be.gte(oldReserves[0].mul(oldReserves[1]).mul(101).div(100))
    expect(oldExternal[0].mul(oldExternal[1])).to.be.lte(newExternal[0].mul(newExternal[1]).mul(1001).div(1000))

    // Check that reserves and balances make sense
    expect(newReserves[0].add(newExternal[0]).add(await token0.balanceOf(wallet.address))).to.be.eq(oldReserves[0].add(oldExternal[0]).add(bal0))
    expect(newReserves[1].add(newExternal[1]).add(await token1.balanceOf(wallet.address))).to.be.eq(oldReserves[1].add(oldExternal[1]).add(bal1))

    // Check that arbitrage is efficient
    const o0 = new BN(newReserves[0].toString())
    const o1 = new BN(newReserves[1].toString())  
    const u0 = new BN(newExternal[0].toString())
    const u1 = new BN(newExternal[1].toString())  
    const price = o1.div(o0)
    const externalPrice = u1.div(u0)

    const eff = (externalPrice >= price.multipliedBy(new BN(0.9969))) && (externalPrice <= price.multipliedBy(new BN(1.0031)))
    expect(eff).to.be.true
  })

  it('swap:overflow', async () => {
    const token0Amount = expandTo18Decimals(50)
    const token1Amount = expandTo18Decimals(100)
    await addLiquidity(token0Amount, token1Amount)
    let swapAmount = bigNumberify(2).pow(113).sub(bigNumberify(10).pow(20).sub(1).mul(2))
    let expectedOutputAmount = bigNumberify('1')
    await token1.transfer(pair.address, swapAmount)
    await expect(pair.swap(0, expectedOutputAmount, wallet.address, '0x', overrides)).to.be.revertedWith('NostraSwap: OVERFLOW')
  })

  it('swap:gas (loop = 1 round)', async () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)

    // ensure that setting latestPriceOracle0 for the first time doesn't affect our gas math
    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
    await pair.sync(overrides)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = bigNumberify('453305446940074565')
    await token1.transfer(pair.address, swapAmount)
    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
    const tx = await pair.swap(expectedOutputAmount, 0, wallet.address, '0x', overrides)
    const receipt = await tx.wait()
    expect(receipt.gasUsed).to.eq(164073)
  })

  it('swap:gas (loop > 1 round)', async () => {
    const token0Amount = expandTo18Decimals(50)
    const token1Amount = expandTo18Decimals(100)
    const blockTime  = (await provider.getBlock('latest')).timestamp
    await addLiquidity(token0Amount, token1Amount)

    // ensure that setting latestPriceOracle0 for the first time doesn't affect our gas math
    await mineBlock(provider,  blockTime + 1)
    await pair.sync(overrides)

    const swapAmount = expandTo18Decimals(49)
    const expectedOutputAmount = bigNumberify('453305446940074565')
    await token1.transfer(pair.address, swapAmount)
    await mineBlock(provider, (blockTime + 3001))
    let tx = await pair.swap(expectedOutputAmount, 0, wallet.address, '0x', overrides)
    let receipt = await tx.wait()
    expect(receipt.gasUsed).to.eq(163398)

    await token0.transfer(pair.address, expectedOutputAmount)
    await mineBlock(provider, blockTime + 6001)
    tx = await pair.swap(0, bigNumberify('453305446940074565'), wallet.address, '0x', overrides)
    receipt = await tx.wait()
    expect(receipt.gasUsed).to.eq(215396)
  })

  it('lpips', async () => {
    const limitRate = await pair.limitRate()
    const lpipsExponent = [1, 2, 4, 8, 16, 32, 64, 128]
    const decimalAccuracy = 10 ** 8 // 8 decimals
    for (let i = 0; i < lpipsExponent.length; i++) {
      const lpipsDownside = new BN(await pair.lpips(i, 0)).times(decimalAccuracy)
      const lpipsUpside = new BN(await pair.lpips(i, 1)).times(decimalAccuracy)
      const expectedDownside = new BN(1).minus(new BN(limitRate).div(10000000)).pow(lpipsExponent[i]).times(decimalAccuracy)
      const expectedUpside = new BN(1).plus(new BN(limitRate).div(10000000)).pow(lpipsExponent[i]).times(decimalAccuracy)
      expect(lpipsDownside.div(new BN(2).pow(112)).toFixed(0, 1)).to.eq(expectedDownside.toFixed(0, 1))
      expect(lpipsUpside.div(new BN(2).pow(112)).toFixed(0, 1)).to.eq(expectedUpside.toFixed(0, 1))
    }
  })

  it('setPriceImpact', async () => {
    const newRate = 500
    await expect(pair.setLimitPriceImpact(0)).to.be.revertedWith('NostraSwap: RATE_ZERO')
    await expect(pair.connect(other).setLimitPriceImpact(newRate)).to.be.revertedWith('NostraSwap: FORBIDDEN')
    await pair.setLimitPriceImpact(newRate)
    const limitRate = await pair.limitRate()
    expect(limitRate).to.eq(newRate)
    const lpipsExponent = [1, 2, 4, 8, 16, 32, 64, 128]
    const decimalAccuracy = 10 ** 8 // 8 decimals
    for (let i = 0; i < lpipsExponent.length; i++) {
      const lpipsDownside = new BN(await pair.lpips(i, 0)).times(decimalAccuracy)
      const lpipsUpside = new BN(await pair.lpips(i, 1)).times(decimalAccuracy)
      const expectedDownside = new BN(1).minus(new BN(newRate).div(10000000)).pow(lpipsExponent[i]).times(decimalAccuracy)
      const expectedUpside = new BN(1).plus(new BN(newRate).div(10000000)).pow(lpipsExponent[i]).times(decimalAccuracy)
      expect(lpipsDownside.div(new BN(2).pow(112)).toFixed(0, 1)).to.eq(expectedDownside.toFixed(0, 1))
      expect(lpipsUpside.div(new BN(2).pow(112)).toFixed(0, 1)).to.eq(expectedUpside.toFixed(0, 1))
    }
  })

  it('oraclePrice{0,1}', async () => {
    const Q112 = new BN(2).pow(112)
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)

    const spotPrice0BeforeSwap = new BN(token1Amount.toString()).div(token0Amount.toString())
    const spotPrice1BeforeSwap = new BN(token0Amount.toString()).div(token1Amount.toString())
    const limitRate = new BN(400).div(10000000)
    let timeElapsed = 32
    const decimalAccuracy = 10 ** 6 // 6 decimals

    // Check oracle price 36 seconds
    let swapAmount = expandTo18Decimals(1)
    let expectedOutputAmount = bigNumberify('1662497915624478906')
    await token0.transfer(pair.address, swapAmount)
    let beforeSwapTimestamp = (await provider.getBlock('latest')).timestamp
    await pair.swap(0, expectedOutputAmount, wallet.address, '0x', overrides)
    const afterSwapTimestamp = (await provider.getBlock('latest')).timestamp
    await mineBlock(provider, beforeSwapTimestamp + timeElapsed)

    let oraclePrice0 = new BN((await pair.getOraclePrice0())[0]).div(Q112)
    let oraclePrice1 = new BN((await pair.getOraclePrice1())[0]).div(Q112)

    let limitedPrice0 = spotPrice0BeforeSwap.times(new BN(1).minus(limitRate).pow(timeElapsed))
    let limitedPrice1 = spotPrice1BeforeSwap.times(new BN(1).plus(limitRate).pow(timeElapsed))

    expect(oraclePrice0.times(decimalAccuracy).toFixed(0, 1)).to.eq(limitedPrice0.times(decimalAccuracy).toFixed(0, 1))
    expect(oraclePrice1.times(decimalAccuracy).toFixed(0, 1)).to.eq(limitedPrice1.times(decimalAccuracy).toFixed(0, 1))

    // Check oracle price 45 seconds
    timeElapsed = 45
    await mineBlock(provider, beforeSwapTimestamp + timeElapsed)

    oraclePrice0 = new BN((await pair.getOraclePrice0())[0]).div(Q112)
    oraclePrice1 = new BN((await pair.getOraclePrice1())[0]).div(Q112)

    limitedPrice0 = spotPrice0BeforeSwap.times(new BN(1).minus(limitRate).pow(timeElapsed))
    limitedPrice1 = spotPrice1BeforeSwap.times(new BN(1).plus(limitRate).pow(timeElapsed))

    expect(oraclePrice0.times(decimalAccuracy).toFixed(0, 1)).to.eq(limitedPrice0.times(decimalAccuracy).toFixed(0, 1))
    expect(oraclePrice1.times(decimalAccuracy).toFixed(0, 1)).to.eq(limitedPrice1.times(decimalAccuracy).toFixed(0, 1))

    // swap back the other way
    swapAmount = expandTo18Decimals(11)
    expectedOutputAmount = bigNumberify('1')
    await token1.transfer(pair.address, swapAmount)
    beforeSwapTimestamp = beforeSwapTimestamp + timeElapsed
    await pair.swap(expectedOutputAmount, 0, wallet.address, '0x', overrides)

    oraclePrice0 = new BN((await pair.getOraclePrice0())[0]).div(Q112)
    oraclePrice1 = new BN((await pair.getOraclePrice1())[0]).div(Q112)

    expect(oraclePrice0.times(decimalAccuracy).toFixed(0, 1)).to.eq(limitedPrice0.times(decimalAccuracy).toFixed(0, 1))
    expect(oraclePrice1.times(decimalAccuracy).toFixed(0, 1)).to.eq(limitedPrice1.times(decimalAccuracy).toFixed(0, 1))

    timeElapsed = 15
    await mineBlock(provider, beforeSwapTimestamp + timeElapsed)

    limitedPrice0 = oraclePrice0.times(new BN(1).plus(limitRate).pow(timeElapsed))
    limitedPrice1 = oraclePrice1.times(new BN(1).minus(limitRate).pow(timeElapsed))

    oraclePrice0 = new BN((await pair.getOraclePrice0())[0]).div(Q112)
    oraclePrice1 = new BN((await pair.getOraclePrice1())[0]).div(Q112)

    expect(oraclePrice0.times(decimalAccuracy).toFixed(0, 1)).to.eq(limitedPrice0.times(decimalAccuracy).toFixed(0, 1))
    expect(oraclePrice1.times(decimalAccuracy).toFixed(0, 1)).to.eq(limitedPrice1.times(decimalAccuracy).toFixed(0, 1))
  })

  it('burn', async () => {
    const token0Amount = expandTo18Decimals(3)
    const token1Amount = expandTo18Decimals(3)
    const bal0 = await token0.balanceOf(wallet.address)
    const bal1 = await token1.balanceOf(wallet.address)
    await addLiquidity(token0Amount, token1Amount)
    

    const expectedLiquidity = expandTo18Decimals(3)
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    await expect(pair.burn(wallet.address, overrides))
      .to.emit(pair, 'Transfer')
      .withArgs(pair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(token0, 'Transfer')
      .withArgs(pair.address, wallet.address, token0Amount.sub(1000))
      .to.emit(token1, 'Transfer')
      .withArgs(pair.address, wallet.address, token1Amount.sub(1000))
      .to.emit(pair, 'Sync')
      .withArgs(1000, 1000)
      .to.emit(pair, 'Burn')
      .withArgs(wallet.address, token0Amount.sub(1000), token1Amount.sub(1000), wallet.address)

    expect(await pair.balanceOf(wallet.address)).to.eq(0)
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY)
    expect(await token0.balanceOf(pair.address)).to.eq(1000)
    expect(await token1.balanceOf(pair.address)).to.eq(1000)
    expect(await token0.balanceOf(wallet.address)).to.eq(bal0.sub(1000))
    expect(await token1.balanceOf(wallet.address)).to.eq(bal1.sub(1000))
  })

  it('feeTo:off', async () => {
    const token0Amount = expandTo18Decimals(1000)
    const token1Amount = expandTo18Decimals(1000)
    await addLiquidity(token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = bigNumberify('996006981039903216')
    await token1.transfer(pair.address, swapAmount)
    await pair.swap(expectedOutputAmount, 0, wallet.address, '0x', overrides)

    const expectedLiquidity = expandTo18Decimals(1000)
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    await pair.burn(wallet.address, overrides)
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY)
  })

  it('feeTo:on', async () => {
    await factory.setFeeTo(other.address)

    const token0Amount = expandTo18Decimals(1000)
    const token1Amount = expandTo18Decimals(1000)
    await addLiquidity(token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = bigNumberify('996006981039903216')
    await token1.transfer(pair.address, swapAmount)
    await pair.swap(expectedOutputAmount, 0, wallet.address, '0x', overrides)

    const expectedLiquidity = expandTo18Decimals(1000)
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    await pair.burn(wallet.address, overrides)

    const liquidity = await pair.balanceOf(other.address)
    let otherPair = pair.connect(other)
    await otherPair.transfer(otherPair.address, liquidity)
    await otherPair.burn(other.address, overrides)
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY)
    const liq = (await token0.balanceOf(pair.address)).mul(await token1.balanceOf(pair.address))
    expect(liq).to.be.gte(MINIMUM_LIQUIDITY.mul(MINIMUM_LIQUIDITY))
    expect(liq.mul(100)).to.be.lte(MINIMUM_LIQUIDITY.mul(MINIMUM_LIQUIDITY).mul(101))
  })
})
