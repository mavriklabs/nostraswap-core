import BN from 'bignumber.js'
import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'
import { BigNumber, bigNumberify } from 'ethers/utils'

import { encodeParameters, mineBlock } from './shared/utilities-periphery'
import { timelockFixture } from './shared/fixtures'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('Timelock', () => {
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
  let timelock: Contract
  let delay: number
  beforeEach(async () => {
    const fixture = await loadFixture(timelockFixture)
    factory = fixture.factory
    token0 = fixture.token0
    token1 = fixture.token1
    pair = fixture.pair
    timelock = fixture.timelock
    delay = (await timelock.delay()).toNumber()
  })

  it('initial timelock to factory', async () => {
    expect((await timelock.admin())).to.eq(wallet.address)
    expect((await factory.owner())).to.eq(timelock.address)
    expect((await timelock.delay())).to.eq(21600)
  })

  it('setDelay', async () => {
    const newDelay = 30000
    await expect(timelock.setDelay(newDelay)).to.be.reverted
    const blockTimestamp = (await provider.getBlock('latest')).timestamp
    let eta = blockTimestamp + delay + 60
    await timelock.queueTransaction(
      timelock.address,
      0,
      'setDelay(uint256)',
      encodeParameters(['uint256'], [newDelay]),
      eta
    )
    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + delay + 60)
    await timelock.executeTransaction(
      timelock.address,
      0,
      'setDelay(uint256)',
      encodeParameters(['uint256'], [newDelay]),
      eta
    )
    expect((await timelock.delay())).to.eq(newDelay)
  })

  it('setPendingAdmin', async () => {
    const newAdmin = other.address
    await expect(timelock.setPendingAdmin(newAdmin)).to.be.reverted
    const blockTimestamp = (await provider.getBlock('latest')).timestamp
    let eta = blockTimestamp + delay + 60
    await timelock.queueTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )
    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + delay + 60)
    await timelock.executeTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )
    expect((await timelock.pendingAdmin())).to.eq(newAdmin)
  })

  it('queueTransaction', async () => {
    const newAdmin = other.address
    const blockTimestamp = (await provider.getBlock('latest')).timestamp
    let eta = blockTimestamp + delay + 60
    let txn = await timelock.queueTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )
    let txnHash = (await txn.wait()).events[0].args['0']
    expect((await timelock.queuedTransactions(txnHash))).to.be.true
  })

  it('cancelTransaction', async () => {
    const newAdmin = other.address
    const blockTimestamp = (await provider.getBlock('latest')).timestamp
    let eta = blockTimestamp + delay + 60
    let txn = await timelock.queueTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )
    let txnHash = (await txn.wait()).events[0].args['0']

    await timelock.cancelTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )
    expect((await timelock.queuedTransactions(txnHash))).to.be.false
  })

  it('executeTransaction', async () => {
    const newAdmin = other.address
    const blockTimestamp = (await provider.getBlock('latest')).timestamp
    let eta = blockTimestamp + delay + 60
    //execute before queue
    await expect(timelock.executeTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't been queued.")

    //execute before ETA
    await timelock.queueTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )
    await expect(timelock.executeTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.")
    await mineBlock(provider, eta-1)
    await expect(timelock.executeTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.")
    await mineBlock(provider, eta)

    //execute after ETA + grace
    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 14*24*60*60+2)
    await expect(timelock.executeTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )).to.be.revertedWith("Timelock::executeTransaction: Transaction is stale.")
  })

  it('requireAdmin', async () => {
    const newAdmin = other.address
    const blockTimestamp = (await provider.getBlock('latest')).timestamp
    let eta = blockTimestamp + delay + 60
    timelock = await timelock.connect(other)
    await expect(timelock.queueTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )).to.be.revertedWith("Timelock::queueTransaction: Call must come from admin.")
    await expect(timelock.cancelTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )).to.be.revertedWith("Timelock::cancelTransaction: Call must come from admin.")
    await expect(timelock.executeTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )).to.be.revertedWith("Timelock::executeTransaction: Call must come from admin.")
  })

  it('acceptAdmin', async () => {
    const newAdmin = other.address
    const blockTimestamp = (await provider.getBlock('latest')).timestamp
    let eta = blockTimestamp + delay + 60

    //accept before setting pendingAdmin
    timelock = await timelock.connect(other)
    await expect(timelock.acceptAdmin()).to.be.revertedWith("Timelock::acceptAdmin: Call must come from pendingAdmin.")
    
    timelock = await timelock.connect(wallet)

    await timelock.queueTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )
    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + delay + 60)
    await timelock.executeTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta
    )
    expect((await timelock.pendingAdmin())).to.eq(newAdmin)

    //Admin still the same before pendingAdmin accepts 
    await timelock.queueTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta + delay + 60
    )
    await timelock.cancelTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [newAdmin]),
      eta + delay + 60
    )

    // accepts Admin
    timelock = await timelock.connect(other)
    await timelock.acceptAdmin()
    expect(await timelock.admin()).to.eq(newAdmin)

    //other has admin privileges 
    await timelock.queueTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [wallet.address]),
      eta + delay + 60
    )
    await timelock.cancelTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [wallet.address]),
      eta + delay + 60
    )

    //wallet has no privilege
    timelock = await timelock.connect(wallet)
    await expect(timelock.queueTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [wallet.address]),
      eta + delay + 60
    )).to.be.revertedWith("Timelock::queueTransaction: Call must come from admin.")
    await expect(timelock.cancelTransaction(
      timelock.address,
      0,
      'setPendingAdmin(address)',
      encodeParameters(['address'], [wallet.address]),
      eta + delay + 60
    )).to.be.revertedWith("Timelock::cancelTransaction: Call must come from admin.")
  })

  it('timelockChangePriceImpact', async () => {
    const newRate = 900
    let blockTimestamp = (await provider.getBlock('latest')).timestamp
    let eta = blockTimestamp + delay + 60
    expect(await pair.limitRate()).to.eq(400)

    //set rate to 0, should revert
    await timelock.queueTransaction(
      pair.address,
      0,
      'setLimitPriceImpact(uint112)',
      encodeParameters(['uint112'], [0]),
      eta
    )

    await mineBlock(provider, eta+1)
    await expect(timelock.executeTransaction(
      pair.address,
      0,
      'setLimitPriceImpact(uint112)',
      encodeParameters(['uint112'], [0]),
      eta
    )).to.be.revertedWith("VM Exception while processing transaction: revert Timelock::executeTransaction: Transaction execution reverted.")



    blockTimestamp = (await provider.getBlock('latest')).timestamp
    eta = blockTimestamp + delay + 60

    //set rate to newRate
    await timelock.queueTransaction(
      pair.address,
      0,
      'setLimitPriceImpact(uint112)',
      encodeParameters(['uint112'], [newRate]),
      eta
    )

    await mineBlock(provider, eta+1)
    await timelock.executeTransaction(
      pair.address,
      0,
      'setLimitPriceImpact(uint112)',
      encodeParameters(['uint112'], [newRate]),
      eta
    )
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

  it('setFactoryOwner', async () => {
    //only timelock can setOwner
    expect(await factory.owner()).to.eq(timelock.address)
    await expect(factory.setOwner(wallet.address)).to.be.revertedWith("NostraSwap: FORBIDDEN")

    //change owner to wallet
    let eta = (await provider.getBlock("latest")).timestamp + delay + 60
    await timelock.queueTransaction(
      factory.address,
      0,
      'setOwner(address)',
      encodeParameters(['address'], [wallet.address]),
      eta
    )
    await mineBlock(provider, eta+100)
    await timelock.executeTransaction(
      factory.address,
      0,
      'setOwner(address)',
      encodeParameters(['address'], [wallet.address]),
      eta
    )

    expect(await factory.owner()).to.eq(wallet.address)

    await factory.setOwner(timelock.address)

    expect(await factory.owner()).to.eq(timelock.address)
  })
})
